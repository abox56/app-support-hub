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
    const connection = await mysql.createConnection(DATABASE_URL);
    console.log("✅ Connected.");

    // 1. "Ticket Not Tally" Analysis
    console.log("🔍 Scanning for 'Ticket Not Tally' issues...");
    const [tallyRows] = await connection.execute(`
        SELECT content, ai_summary, timestamp, chat_title
        FROM message_analysis_logs 
        WHERE (content LIKE '%tally%' OR content LIKE '%match%' OR content LIKE '%不平%' OR content LIKE '%不匹配%')
          AND ai_category NOT IN ('NOISE', '[NOISE]')
    `);

    console.log(`📊 Found ${tallyRows.length} records related to tally issues.`);

    const providersInTally = {};
    tallyRows.forEach(row => {
        const text = (row.content + " " + (row.ai_summary || "")).toLowerCase();
        const providers = ['Evolution', 'Pragmatic', 'PP', 'PG', 'Jili', 'Spade', 'Sexy', 'SBO', 'Ibbet', 'RSG', 'SABA', 'PT', 'WM', 'BG', 'DG', 'SA', 'JDB'];
        providers.forEach(p => {
            if (text.includes(p.toLowerCase())) {
                providersInTally[p] = (providersInTally[p] || 0) + 1;
            }
        });
    });

    console.log("\n📌 Providers most associated with 'Not Tally':");
    Object.entries(providersInTally).sort((a, b) => b[1] - a[1]).forEach(([p, c]) => console.log(` - ${p}: ${c}`));

    // 2. Team Member Analysis (WDJ, IvanWong, SW)
    console.log("\n🔍 Analyzing Team Member Activities (WDJ, IvanWong, SW)...");
    
    // We search across incidents and message logs
    const teamMembers = {
        'WDJ': ['DJ', 'WDJ', 'wdj', '@cw_wdj'],
        'IvanWong': ['Ivan', 'IvanWong', 'ivan', '@hchcw25'],
        'SW': ['Shawn', 'SW', 'shawn', '@CW_SWSW']
    };

    const categoryStats = {}; // { Member: { Category: Count } }
    const mentionStats = {}; // { Member: { Category: Count } }

    for (const [memberKey, aliases] of Object.entries(teamMembers)) {
        categoryStats[memberKey] = {};
        mentionStats[memberKey] = {};
        
        // Count from message_analysis_logs (as sender)
        const nameQuery = aliases.map(a => `sender LIKE '%${a}%'`).join(' OR ');
        const [logs] = await connection.execute(`
            SELECT ai_category, COUNT(*) as count 
            FROM message_analysis_logs 
            WHERE ${nameQuery}
            GROUP BY ai_category
        `);
        
        logs.forEach(row => {
            const cat = row.ai_category || 'Unknown';
            categoryStats[memberKey][cat] = (categoryStats[memberKey][cat] || 0) + row.count;
        });

        // NEW: Count Mentions in content
        const mentionQuery = aliases.map(a => `content LIKE '%${a}%'`).join(' OR ');
        const [mentions] = await connection.execute(`
            SELECT ai_category, COUNT(*) as count 
            FROM message_analysis_logs 
            WHERE ${mentionQuery}
            GROUP BY ai_category
        `);
        
        mentions.forEach(row => {
            const cat = row.ai_category || 'Unknown';
            mentionStats[memberKey][cat] = (mentionStats[memberKey][cat] || 0) + row.count;
        });

        // Count from incidents (as assigned_to)
        const assignedQuery = aliases.map(a => `assigned_to LIKE '%${a}%'`).join(' OR ');
        const [incidents] = await connection.execute(`
            SELECT category, COUNT(*) as count 
            FROM incidents 
            WHERE ${assignedQuery}
            GROUP BY category
        `);

        incidents.forEach(row => {
            const cat = row.category || 'Unknown';
            categoryStats[memberKey][cat] = (categoryStats[memberKey][cat] || 0) + row.count;
        });
    }

    console.log("\n📊 Request Categorization by Team Member (Direct Participation):");
    for (const [member, stats] of Object.entries(categoryStats)) {
        console.log(`\n👨‍💻 ${member}:`);
        const sortedStats = Object.entries(stats).sort((a, b) => b[1] - a[1]);
        if (sortedStats.length === 0) {
            console.log(" - No direct participations logged.");
        } else {
            sortedStats.forEach(([cat, count]) => {
                console.log(` - ${cat}: ${count}`);
            });
        }
    }

    console.log("\n💬 Requests Mentioning/Tagging Team Members:");
    for (const [member, stats] of Object.entries(mentionStats)) {
        console.log(`\n👨‍💻 ${member} (Mentioned):`);
        const sortedStats = Object.entries(stats).sort((a, b) => b[1] - a[1]);
        if (sortedStats.length === 0) {
            console.log(" - No mentions found.");
        } else {
            sortedStats.forEach(([cat, count]) => {
                console.log(` - ${cat}: ${count}`);
            });
        }
    }

    // 3. Specific "Not Tally" samples for team
    console.log("\n📋 Sample 'Not Tally' requests involving team members:");
    const [teamTallyRows] = await connection.execute(`
        SELECT sender, content, timestamp 
        FROM message_analysis_logs 
        WHERE (content LIKE '%tally%' OR content LIKE '%match%' OR content LIKE '%不平%' OR content LIKE '%不匹配%')
          AND (sender LIKE '%DJ%' OR sender LIKE '%Ivan%' OR sender LIKE '%Shawn%' OR sender LIKE '%WDJ%' OR sender LIKE '%SW%')
        LIMIT 5
    `);
    
    teamTallyRows.forEach(row => {
        console.log(` - [${row.sender}] ${row.content.replace(/\n/g, ' ').substring(0, 100)}...`);
    });

    await connection.end();
}

analyze().catch(err => {
    console.error("❌ Analysis failed:", err.message);
});
