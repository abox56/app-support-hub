require('dotenv').config();
const mysql = require('mysql2/promise');

function getDatabaseUrl() {
    return (
        process.env.MYSQL_PRIVATE_URL ||
        process.env.MYSQL_URL ||
        process.env.DATABASE_URL ||
        ''
    ).trim();
}

async function analyze() {
    const DATABASE_URL = getDatabaseUrl();
    if (!DATABASE_URL) {
        console.error(
            '❌ Missing MySQL URL. Set MYSQL_PRIVATE_URL, MYSQL_URL, or DATABASE_URL in .env (copy from Railway).'
        );
        process.exit(1);
    }

    console.log("💎 Connecting to Railway MySQL...");
    let connection;
    try {
        connection = await mysql.createConnection(DATABASE_URL);
        console.log("✅ Connected.");
    } catch (e) {
        console.error("❌ SQL Connection Error:", e.message);
        return;
    }

    // 1. Get all messages that are PRovider Alerts or might contain provider names
    console.log("🔍 Scanning message_analysis_logs for provider-related issues...");
    const [rows] = await connection.execute(`
        SELECT content, ai_summary, ai_category 
        FROM message_analysis_logs 
        WHERE ai_category IN ('PROVIDER_ALERTS', '[PROVIDER_ALERTS]', 'Provider API') 
           OR content LIKE '%Evolution%' 
           OR content LIKE '%Pragmatic%' 
           OR content LIKE '%PG%' 
           OR content LIKE '%Jili%' 
           OR content LIKE '%SpadeGaming%' 
           OR content LIKE '%Sexy%' 
           OR content LIKE '%SBO%' 
           OR content LIKE '%Ibbet%'
    `);

    console.log(`📊 Found ${rows.length} relevant records.`);

    if (rows.length === 0) {
        // Try all messages if none found with filters
        const [allRows] = await connection.execute("SELECT content, ai_summary, ai_category FROM message_analysis_logs LIMIT 1000");
        console.log(`⚠️ No specific provider alerts found. Analyzing all messages вместо этого... (${allRows.length} total)`);
        processRows(allRows);
    } else {
        processRows(rows);
    }

    await connection.end();
}

function processRows(rows) {
    const providerCounts = {};
    const providerPatterns = {};

    const providers = [
        'Evolution', 'Pragmatic', 'PP', 'PG', 'PGSoft', 'Jili', 'SpadeGaming', 'Spade', 'AE', 'Sexy', 'SBO', 'Ibbet',
        'Ufabet', 'UFA', 'KingMaker', 'MicroGaming', 'RedTiger', 'Habanero', 'Joker', 'CQ9', 'Relax',
        'RSG', 'SABA', 'PT', 'Playtech', 'WM', 'BG', 'DG', 'AllBet', 'SA', 'Fachai', 'FC', 'JDB', 'Mega888', '918Kiss'
    ];

    rows.forEach(row => {
        const content = row.content || "";
        const title = row.chat_title || "";
        const combinedText = (content + " " + (row.ai_summary || "")).toLowerCase();
        
        // Skip common non-failure patterns
        if (combinedText.includes("new game") || combinedText.includes("release") || combinedText.includes("notification") || combinedText.includes("promotion")) {
            return;
        }

        providers.forEach(p => {
            const pLow = p.toLowerCase();
            const regex = new RegExp('\\b' + pLow + '\\b', 'i');
            if (regex.test(combinedText)) {
                // Check if it's an actual failure
                const lowContent = content.toLowerCase();
                const isFault = lowContent.includes("maintenance") || lowContent.includes("close") || lowContent.includes("off") || lowContent.includes("维护") || lowContent.includes("关闭") ||
                               lowContent.includes("lag") || lowContent.includes("slow") || lowContent.includes("delay") || lowContent.includes("卡") || lowContent.includes("慢") ||
                               lowContent.includes("wallet") || lowContent.includes("transfer") || lowContent.includes("上分") || lowContent.includes("额度") || lowContent.includes("钱包") || lowContent.includes("转账") ||
                               lowContent.includes("crash") || lowContent.includes("down") || lowContent.includes("挂") || lowContent.includes("断") || lowContent.includes("打不开");
                
                if (isFault) {
                    providerCounts[p] = (providerCounts[p] || 0) + 1;
                    if (!providerPatterns[p]) providerPatterns[p] = [];
                    providerPatterns[p].push(content);
                }
            }
        });
    });

    // Special merge for PG and PGSoft
    if (providerCounts['PGSoft']) {
        providerCounts['PG'] = (providerCounts['PG'] || 0) + providerCounts['PGSoft'];
        providerPatterns['PG'] = (providerPatterns['PG'] || []).concat(providerPatterns['PGSoft'] || []);
        delete providerCounts['PGSoft'];
    }

    // Merging logic
    const merge = (target, source) => {
        if (providerCounts[source]) {
            providerCounts[target] = (providerCounts[target] || 0) + providerCounts[source];
            providerPatterns[target] = (providerPatterns[target] || []).concat(providerPatterns[source] || []);
            delete providerCounts[source];
        }
    };
    
    merge('PG', 'PGSoft');
    merge('Pragmatic', 'PP');
    merge('Sexy', 'AE'); // Sexy is often under AE Group
    merge('UFA', 'Ufabet');
    merge('Spadegaming', 'Spade');
    merge('Playtech', 'PT');

    // Sort by frequency
    const allSorted = Object.entries(providerCounts)
        .sort((a, b) => b[1] - a[1]);

    const sortedProviders = allSorted.slice(0, 3);

    if (allSorted.length === 0) {
        console.log("❌ No technical failures found in any message for the specified providers.");
        return;
    }

    console.log("\n📊 ALL Provider Technical Failure Counts:");
    allSorted.forEach(([name, count]) => console.log(` - ${name}: ${count}`));

    console.log("\n🏆 Top 3 Game Providers with Highest Failure Frequency:");
    sortedProviders.forEach(([name, count], index) => {
        console.log(`${index + 1}. ${name} (${count} incidents)`);
        
        const patterns = providerPatterns[name];
        const errorCategories = {
            "Maintenance/Off (维护/关闭)": 0,
            "Lag/Delay/Slow (大面积卡顿/慢)": 0,
            "Wallet/Points/Transfer (转账/额度/钱包故障)": 0,
            "Login/Connection (异常登录/进入失败)": 0,
            "Bet/Ticket Issue (注单/注单异常)": 0,
            "General Errors (通用报错)": 0
        };

        patterns.forEach(p => {
            const lowP = p.toLowerCase();
            if (lowP.includes("maintenance") || lowP.includes("close") || lowP.includes("off") || lowP.includes("维护") || lowP.includes("关闭")) 
                errorCategories["Maintenance/Off (维护/关闭)"]++;
            else if (lowP.includes("lag") || lowP.includes("slow") || lowP.includes("delay") || lowP.includes("卡") || lowP.includes("慢")) 
                errorCategories["Lag/Delay/Slow (大面积卡顿/慢)"]++;
            else if (lowP.includes("wallet") || lowP.includes("transfer") || lowP.includes("point") || lowP.includes("上分") || lowP.includes("额度") || lowP.includes("钱包") || lowP.includes("转账")) 
                errorCategories["Wallet/Points/Transfer (转账/额度/钱包故障)"]++;
            else if (lowP.includes("login") || lowP.includes("enter") || lowP.includes("open") || lowP.includes("connect") || lowP.includes("进入") || lowP.includes("打不开")) 
                errorCategories["Login/Connection (异常登录/进入失败)"]++;
            else if (lowP.includes("bet") || lowP.includes("ticket") || lowP.includes("void") || lowP.includes("注单") || lowP.includes("派彩"))
                errorCategories["Bet/Ticket Issue (注单/注单异常)"]++;
            else 
                errorCategories["General Errors (通用报错)"]++;
        });

        const sortedPatterns = Object.entries(errorCategories).sort((a, b) => b[1] - a[1]);
        const topPattern = sortedPatterns[0];
        console.log(`   - Most Frequent Pattern: ${topPattern[0]} (${Math.round((topPattern[1]/patterns.length)*100)}%)`);
        
        // Show sample
        const samples = patterns.slice(0, 2).map(s => (s || "").replace(/\n/g, ' ').substring(0, 100));
        console.log(`   - Sample Context: "${samples.join('" | "')}"`);
    });
}

analyze().catch(err => {
    console.error("❌ Analysis failed:", err.message);
});
