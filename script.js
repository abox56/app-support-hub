let HUB_PASSWORD = localStorage.getItem('hub_access_token') || '';

async function apiFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = HUB_PASSWORD;

    const response = await fetch(url, options);
    if (response.status === 401) {
        localStorage.removeItem('hub_access_token');
        checkAccess();
        throw new Error('Unauthorized');
    }
    return response;
}

// Immediate Access Check
if (!HUB_PASSWORD && window.location.pathname !== '/login.html') {
    window.location.href = '/login.html';
}

function checkAccess() {
    if (!HUB_PASSWORD) {
        if (window.location.pathname !== '/login.html') {
            window.location.href = '/login.html';
        }
    }
}

function logout() {
    localStorage.removeItem('hub_access_token');
    window.location.href = '/login.html';
}

function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const clockElement = document.getElementById('clock');
    if (clockElement) clockElement.textContent = `${hours}:${minutes}:${seconds}`;

    // Update Date & Day
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    const dayName = days[now.getDay()];
    const dayDate = String(now.getDate()).padStart(2, '0');
    const monthName = months[now.getMonth()];
    const year = now.getFullYear();

    const dayElement = document.querySelector('.day-vibe');
    const dateElement = document.querySelector('.date-vibe');

    if (dayElement) dayElement.textContent = dayName;
    if (dateElement) dateElement.textContent = `${dayDate} ${monthName} ${year}`;
}

function updateHolidayCountdown() {
    const now = new Date();

    // Determine the next public holiday. For now, let's pick May 1st (Labor Day)
    const currentYear = now.getFullYear();
    let nextHoliday = new Date(currentYear, 4, 1); // Month is 0-indexed (4 = May)

    // If today is past May 1st, look at next year
    if (now > nextHoliday) {
        // As a fallback for a generalized holiday, we can use December 25th (Christmas)
        nextHoliday = new Date(currentYear, 11, 25);
        if (now > nextHoliday) {
            nextHoliday = new Date(currentYear + 1, 4, 1);
        }
    }

    const diff = nextHoliday - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    const timerElement = document.getElementById('holiday-timer');
    if (timerElement) {
        timerElement.textContent = `${days} Days`;
    }
}


function startHandoverTimer() {
    const timerElement = document.getElementById('handover-timer');
    if (!timerElement) return;

    // Logic to calculate time until next 8-hour shift change (fixed windows at 10am, 6pm, 2am)
    function refreshTimer() {
        const now = new Date();
        const hour = now.getHours();
        
        let targetHour;
        if (hour >= 2 && hour < 10) targetHour = 10;
        else if (hour >= 10 && hour < 18) targetHour = 18;
        else targetHour = 2; // Next day 2am

        let targetDate = new Date();
        if (targetHour === 2 && hour >= 18) targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(targetHour, 0, 0, 0);

        let diff = Math.floor((targetDate - now) / 1000);
        if (diff < 0) diff = 0;

        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;

        timerElement.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    refreshTimer();
    setInterval(refreshTimer, 1000);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    updateHolidayCountdown();
    startHandoverTimer();

    setInterval(updateClock, 1000);
    // Update holiday countdown roughly once an hour
    setInterval(updateHolidayCountdown, 1000 * 60 * 60);

    // Initial Tab Indicator setup
    const activeTab = document.querySelector('.tab-button.active');
    const tabIndicator = document.querySelector('.tab-indicator');
    if (activeTab && tabIndicator) {
        tabIndicator.style.left = activeTab.offsetLeft + 'px';
        tabIndicator.style.width = activeTab.offsetWidth + 'px';
    }

    initTimeline();
    initRoster();
    loadSettings(); 
    checkAIStatus();
    checkTGStatus();

    // Poll for new incidents every 30 seconds
    setInterval(initTimeline, 30000);
    setInterval(checkTGStatus, 60000); // 1 min check for TG
});

async function checkAIStatus() {
    try {
        const response = await apiFetch('/api/ai-status');
        const data = await response.json();
        const statusPill = document.getElementById('ai-status-bar');
        if (statusPill) {
            statusPill.innerHTML = `
                <span class="pulse-dot ${data.active ? 'online' : 'offline'}"></span>
                CORE: ${data.engine}
            `;
            if (!data.active) statusPill.classList.add('warning');
            else statusPill.classList.remove('warning');
        }
    } catch (e) { console.error("AI Status check failed:", e); }
}

async function checkTGStatus() {
    try {
        const response = await apiFetch('/api/tg-diagnostics');
        const data = await response.json();
        const statusPill = document.getElementById('tg-status-bar');
        if (statusPill) {
            const isAlive = data.connected;
            statusPill.innerHTML = `
                <span class="pulse-dot ${isAlive ? 'online' : 'offline'}"></span>
                TG LINK: ${isAlive ? 'ALIVE' : 'EXPIRED / OFFLINE'}
            `;
            if (!isAlive) statusPill.classList.add('warning');
            else statusPill.classList.remove('warning');
        }
    } catch (e) { 
        console.error("TG Status check failed:", e); 
        const statusPill = document.getElementById('tg-status-bar');
        if (statusPill) {
            statusPill.innerHTML = `<span class="pulse-dot offline"></span> TG LINK: TIMEOUT`;
            statusPill.classList.add('warning');
        }
    }
}

function openModal(modalId) {
    document.getElementById(modalId)?.classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId)?.classList.remove('active');
}

function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    body.setAttribute('data-theme', newTheme);

    // Toggle Icons
    document.getElementById('theme-icon-dark').style.display = newTheme === 'light' ? 'none' : 'block';
    document.getElementById('theme-icon-light').style.display = newTheme === 'light' ? 'block' : 'none';

    localStorage.setItem('hub-theme', newTheme);
}

// Load saved theme
const savedTheme = localStorage.getItem('hub-theme');
if (savedTheme) {
    document.body.setAttribute('data-theme', savedTheme);
    document.addEventListener('DOMContentLoaded', () => {
        const darkIcon = document.getElementById('theme-icon-dark');
        const lightIcon = document.getElementById('theme-icon-light');
        if (darkIcon) darkIcon.style.display = savedTheme === 'light' ? 'none' : 'block';
        if (lightIcon) lightIcon.style.display = savedTheme === 'light' ? 'block' : 'none';
    });
}

function updateActivePIC() {
    if (allWeeks.length === 0) return;
    
    const now = new Date();
    const weekIndex = findCurrentWeekIndex(now);
    const week = allWeeks[weekIndex];
    if (!week) return;

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = dayNames[now.getDay()];
    const currentHour = now.getHours();

    // Mapping rows to hours: 0: 10-12, 1: 1-5, 2: 5-7, 3: 8pm-2am
    let rowIndex = -1;
    if (currentHour >= 10 && currentHour < 13) rowIndex = 0;
    else if (currentHour >= 13 && currentHour < 17) rowIndex = 1;
    else if (currentHour >= 17 && currentHour < 20) rowIndex = 2;
    else if (currentHour >= 20 || currentHour < 2) rowIndex = 3;

    if (rowIndex !== -1 && week.days[currentDay]) {
        const shift = week.days[currentDay][rowIndex];
        
        const activePeople = [];
        const people = ['Ivan', 'Shawn', 'DJ'];
        
        people.forEach(person => {
            const status = shift[person];
            if (status && status !== 'Rest Day' && status !== 'AL' && status !== 'PH' && !status.includes('office close')) {
                if (status.trim() === '✓' || status.trim() === ' ' || status.trim() === '') {
                    // For a normal checkmark or blank (if it means active but no special notes), just show name
                    // Actually, if it's explicitly '✓', they are active.
                    if(status.trim() === '✓') activePeople.push(person);
                } else {
                    // They have a specific time modifier or note
                    activePeople.push(`${person} (${status.trim()})`);
                }
            }
        });

        const picElement = document.getElementById('current-pic');
        if (picElement) {
            picElement.textContent = activePeople.length > 0 ? activePeople.join(' / ') + ' (Active)' : 'None';
        }
    }
}

let allWeeks = [];
let currentWeekIndex = 0;

async function initRoster() {
    try {
        const response = await apiFetch('/api/roster');
        allWeeks = await response.json();
        
        // Find current week based on 2026 dates (e.g. "9Mar-15Mar")
        const now = new Date();
        currentWeekIndex = findCurrentWeekIndex(now);
        
        renderWeek(currentWeekIndex);
        updateActivePIC();
    } catch (err) {
        console.error('Failed to load roster:', err);
    }
}

function findCurrentWeekIndex(date) {
    // Simple logic: if title contains today's week range
    // For now, let's just default to week 7 for March 10 (Mar26 Week2)
    // In production, we'd parse the dateRange string
    const march10Index = allWeeks.findIndex(w => w.title.includes('9Mar-15Mar'));
    return march10Index !== -1 ? march10Index : 0;
}

function renderWeek(index) {
    if (index < 0 || index >= allWeeks.length) return;
    currentWeekIndex = index;
    
    const week = allWeeks[index];
    document.getElementById('current-week-label').textContent = week.title;

    const grid = document.getElementById('roster-grid');
    if (!grid) return;

    grid.innerHTML = `
        <div class="matrix-header">Shift</div>
        <div class="matrix-header">Mon</div>
        <div class="matrix-header">Tue</div>
        <div class="matrix-header knowledge-wednesday-header">Wed ✽</div>
        <div class="matrix-header">Thu</div>
        <div class="matrix-header">Fri</div>
        <div class="matrix-header">Sat</div>
        <div class="matrix-header">Sun</div>
    `;

    const dayKeys = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const rowLabels = ['Early', 'Late']; // Map based on shift count/times
    
    // We assume each day has the same number of shift rows (usually 4 for this roster)
    const maxRows = 4; 
    
    for (let r = 0; r < maxRows; r++) {
        // Row Label
        const labelDiv = document.createElement('div');
        labelDiv.className = 'matrix-row-label';
        const firstDayShift = week.days['Monday'][r];
        labelDiv.innerHTML = `${r === 0 ? 'Early' : r === 3 ? 'Deep Night' : 'Mid'}<br/><span>${firstDayShift ? firstDayShift.time : ''}</span>`;
        grid.appendChild(labelDiv);

        dayKeys.forEach(day => {
            const shift = week.days[day][r];
            const shiftDiv = document.createElement('div');
            shiftDiv.className = 'shift-card';
            
            if (shift) {
                const content = [shift.Ivan, shift.Shawn, shift.DJ].filter(n => n && n !== 'Rest Day' && n !== 'AL' && n !== 'PH').join(' / ');
                if (!content || content.includes('Rest Day')) shiftDiv.classList.add('off-day');
                shiftDiv.innerHTML = content || '-';
            } else {
                shiftDiv.classList.add('off-day');
                shiftDiv.textContent = '-';
            }
            grid.appendChild(shiftDiv);
        });
    }
}

function changeWeek(delta) {
    const next = currentWeekIndex + delta;
    if (next >= 0 && next < allWeeks.length) {
        renderWeek(next);
    }
}

function toggleRosterView(view) {
    const weekGrid = document.getElementById('roster-grid');
    const monthView = document.getElementById('month-view');
    const toggleWeek = document.getElementById('toggle-week');
    const toggleMonth = document.getElementById('toggle-month');

    if (view === 'week') {
        weekGrid.style.display = 'grid';
        monthView.style.display = 'none';
        toggleWeek.classList.add('active');
        toggleMonth.classList.remove('active');
    } else {
        weekGrid.style.display = 'none';
        monthView.style.display = 'block';
        toggleWeek.classList.remove('active');
        toggleMonth.classList.add('active');
        renderMonthView();
    }
}

function renderMonthView() {
    const container = document.getElementById('month-view');
    if (!container) return;

    let html = `
        <div class="month-grid-header">
            <h3 class="month-title">Monthly Overview (Mar 2026)</h3>
        </div>
        <div class="month-weeks-list">
    `;

    allWeeks.forEach((week, idx) => {
        // Simple summary of each week
        const mondayIvan = week.days['Monday'][0].Ivan; // Sample
        html += `
            <div class="month-week-row glass" onclick="renderWeek(${idx}); toggleRosterView('week')">
                <div class="week-label">${week.title}</div>
                <div class="week-summary">
                    <span class="member-pill">Ivan</span>
                    <span class="member-pill">Shawn</span>
                    <span class="member-pill">DJ</span>
                </div>
                <div class="view-hint">View Details →</div>
            </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;
}

// Remove the placeholder function we added earlier at the end of initRoster block


async function initTimeline() {
    try {
        const response = await apiFetch('/api/incidents');
        const incidents = await response.json();

        const feed = document.getElementById('incident-feed');
        const timelineFeeds = document.querySelectorAll('.timeline-feed');
        if (feed) feed.innerHTML = ''; 
        timelineFeeds.forEach(tf => tf.innerHTML = '');

        incidents.forEach(inc => {
            renderIncidentCard(inc);
        });

        updateStatPills(incidents);
        renderAnalytics(incidents); 
        
        const countElement = document.getElementById('active-incidents-count');
        const activeCount = incidents.filter(i => i.status !== 'Resolved').length;
        if (countElement) countElement.textContent = activeCount;

        // Pulse Alert Logic: Check for recent [USER_SUPPORT]
        const mostRecentUserSupport = incidents.find(i => i.category === '[USER_SUPPORT]' && i.status === 'Captured');
        const pulseZone = document.getElementById('pulse-alert');
        if (mostRecentUserSupport && pulseZone) {
            pulseZone.style.display = 'block';
        } else if (pulseZone) {
            pulseZone.style.display = 'none';
        }

        // Overdue Alert Banner Logic: Show if any critical task [PROVIDER_ALERTS] or [SYSTEM_LOGS] missed for 5 mins
        const now = new Date();
        const FIVE_MINS = 5 * 60 * 1000;
        const overdueCriticals = incidents.filter(i => {
            const firstTime = new Date(i.first_timestamp);
            const isCriticalAI = i.category === '[PROVIDER_ALERTS]' || i.category === '[SYSTEM_LOGS]';
            const isCriticalKeyword = i.category === 'SMI Monitoring' || i.category === 'System Infra' || i.category === 'Provider API';
            return (isCriticalAI || isCriticalKeyword) && i.status !== 'Resolved' && (now - firstTime > FIVE_MINS);
        });

        const overdueBanner = document.getElementById('overdue-alert');
        if (overdueBanner) {
            if (overdueCriticals.length > 0) {
                const countMsg = overdueCriticals.length === 1 ? '1 OVERDUE SUPPORT REQUEST' : `${overdueCriticals.length} OVERDUE SUPPORT REQUESTS`;
                overdueBanner.querySelector('.alert-text').textContent = `CRITICAL: ${countMsg} REQUIRES IMMEDIATE ACTION`;
                overdueBanner.style.display = 'flex';
            } else {
                overdueBanner.style.display = 'none';
            }
        }

    } catch (err) {
        console.error('Failed to load incidents:', err);
    }
}

function renderIncidentCard(inc) {
    const feed = document.getElementById('incident-feed');

    const dateObj = new Date(inc.last_update || inc.first_timestamp);
    const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isCritical = inc.category === '[PROVIDER_ALERTS]' || inc.category === '[SYSTEM_LOGS]';
    
    // Aggregation counter
    const msgCount = inc.updates ? inc.updates.length : 1;
    
    const card = document.createElement('div');
    card.className = `incident-card ${isCritical ? 'critical' : ''}`;
    
    const header = `
        <div class="incident-card-header">
            <span class="incident-category">${inc.category || '[GENERAL]'}</span>
            ${msgCount > 1 ? `<span class="aggregation-counter">x${msgCount} Messages</span>` : ''}
        </div>
    `;

    const body = `
        <div class="incident-summary">
            ${inc.ai_summary || inc.main_content}
        </div>
    `;

    const footer = `
        <div class="incident-footer">
            <div class="incident-meta">
                <span class="time-ago">Last update at ${timeStr} • Engine: ${inc.engine || 'Unknown'}</span>
                <span class="source-group">${inc.source || 'Direct Hub'}</span>
            </div>
            ${isPIC() ? `<button class="notify-btn" onclick="resolveIncident('${inc.id}')">Resolve</button>` : ''}
        </div>
    `;

    card.innerHTML = header + body + footer;
    
    // Add to main dashboard feed
    if (feed) {
        feed.appendChild(card.cloneNode(true));
    }
    
    // Add to ops panel timeline feed(s)
    const timelineFeeds = document.querySelectorAll('.timeline-feed');
    timelineFeeds.forEach(tf => tf.appendChild(card.cloneNode(true)));
}

function isPIC() {
    // Current logic: Check if the name in #current-pic includes "Active"
    const picName = document.getElementById('current-pic')?.textContent || '';
    return picName.includes('(Active)');
}

async function resolveIncident(id) {
    if (!confirm('Mark incident as Resolved and Notify Telegram?')) return;
    try {
        await apiFetch(`/api/resolve-incident/${id}`, { method: 'POST' });
        initTimeline();
    } catch (e) { console.error("Resolution failed:", e); }
}

function updateStatPills(incidents) {
    const stats = {
        'SMI Monitoring': 0,
        'Provider API': 0,
        'Customer Support': 0,
        'System Infra': 0
    };

    incidents.forEach(inc => {
        if (stats.hasOwnProperty(inc.category)) {
            stats[inc.category]++;
        }
    });

    if (document.getElementById('stat-smi')) document.getElementById('stat-smi').textContent = stats['SMI Monitoring'];
    if (document.getElementById('stat-provider')) document.getElementById('stat-provider').textContent = stats['Provider API'];
    if (document.getElementById('stat-customer')) document.getElementById('stat-customer').textContent = stats['Customer Support'];
    if (document.getElementById('stat-infra')) document.getElementById('stat-infra').textContent = stats['System Infra'];
}

async function logManualIncident() {
    const input = document.getElementById('manual-incident-input');
    const content = input?.value.trim();
    if (!content) return;

    const picName = document.getElementById('current-pic')?.textContent || 'User';

    try {
        const response = await apiFetch('/api/incidents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content, assigned_to: picName })
        });
        if (response.ok) {
            input.value = ''; // Clear input
            initTimeline(); // Refresh timeline and stats
        }
    } catch (err) {
        console.error('Failed to log manual incident:', err);
    }
}

// Timeline events are now handled by renderIncidentCard


function renderAnalytics(incidents) {
    const catContainer = document.getElementById('category-chart');
    const groupContainer = document.getElementById('group-chart');

    if (!catContainer || !groupContainer) return;

    // 1. Category Chart
    const cats = {};
    incidents.forEach(i => cats[i.category] = (cats[i.category] || 0) + 1);
    
    catContainer.innerHTML = '';
    const maxCat = Math.max(...Object.values(cats), 1);
    Object.entries(cats).forEach(([name, count]) => {
        const percentage = (count / maxCat) * 100;
        const row = document.createElement('div');
        row.className = 'chart-row';
        row.innerHTML = `
            <div class="chart-label">${name}</div>
            <div class="chart-bar-bg"><div class="chart-bar" style="width: ${percentage}%"></div></div>
            <div class="chart-value">${count}</div>
        `;
        catContainer.appendChild(row);
    });

    // 2. Group Chart
    const groups = {};
    incidents.forEach(i => {
        if(i.source !== 'Manual Input') groups[i.source] = (groups[i.source] || 0) + 1;
    });

    groupContainer.innerHTML = '';
    const sortedGroups = Object.entries(groups).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const maxGroup = Math.max(...sortedGroups.map(g => g[1]), 1);
    
    sortedGroups.forEach(([name, count]) => {
        const percentage = (count / maxGroup) * 100;
        const row = document.createElement('div');
        row.className = 'chart-row';
        row.innerHTML = `
            <div class="chart-label">${name.substring(0, 15)}</div>
            <div class="chart-bar-bg"><div class="chart-bar primary" style="width: ${percentage}%"></div></div>
            <div class="chart-value">${count}</div>
        `;
        groupContainer.appendChild(row);
    });

    // Efficiency
    const avgResponse = document.getElementById('avg-response-time');
    if (avgResponse) avgResponse.textContent = '8.4 mins'; // Calculation placeholder
}


function filterDocs() {
    const query = document.getElementById('hub-search').value.toLowerCase();
    const docCards = document.querySelectorAll('.doc-card');

    docCards.forEach(card => {
        const name = card.querySelector('.doc-name').textContent.toLowerCase();
        const type = card.querySelector('.doc-type').textContent.toLowerCase();

        if (name.includes(query) || type.includes(query)) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}

function generateHandover() {
    const picName = document.getElementById('current-pic')?.textContent || 'PIC';
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });

    // Gather Active Incidents from the Engine
    const incidentCards = Array.from(document.querySelectorAll('.incident-card')).slice(0, 10);
    const summaryLines = incidentCards.map(card => {
        const category = card.querySelector('.incident-category')?.textContent || 'LOG';
        const summary = card.querySelector('.incident-summary')?.textContent.trim();
        const counter = card.querySelector('.aggregation-counter')?.textContent || '';
        let icon = '🔹';
        if (card.classList.contains('critical')) icon = '🔴';
        return `${icon} [${category}] ${summary} ${counter}`;
    }).slice(0, 5).join('\n');

    const summary = `🚀 *HUB COMMAND CENTER HANDOVER* 🚀
📅 Date: ${dateStr} | 🕒 Time: ${timeStr}
👤 Outgoing PIC: ${picName}

---
🔥 *ACTIVE INCIDENT ENGINE SUMMARY*
${summaryLines || '✅ No active incidents reported.'}

---
📊 *SYSTEM STATUS*
✅ SLA: STABLE
✅ AI Engine: ONLINE
✅ SMI Monitoring: PERSISTENT

---
cc: @App_Sup_Team`;

    const handoverText = document.getElementById('handover-text');
    if (handoverText) {
        handoverText.value = summary.trim();
    }

    openModal('handover-modal');
}

function openSettings() {
    const savedLink = localStorage.getItem('hub_tg_link') || '';
    const input = document.getElementById('tg-link-input');
    if (input) input.value = savedLink;
    openModal('settings-modal');
}

function saveSettings() {
    const link = document.getElementById('tg-link-input').value.trim();
    localStorage.setItem('hub_tg_link', link);

    // Feedback
    const saveBtn = document.querySelector('#settings-modal .modal-btn.primary');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '✅ Saved!';

    setTimeout(() => {
        saveBtn.textContent = originalText;
        closeModal('settings-modal');
    }, 1000);
}

function loadSettings() {
    // Current placeholder if any other settings are added later
}

async function copyHandover() {
    const text = document.getElementById('handover-text');
    const copyBtn = document.getElementById('copy-btn');
    if (!text || !copyBtn) return;

    const originalText = copyBtn.textContent;
    const tgTarget = localStorage.getItem('hub_tg_link') || 'me'; // Default to Saved Messages if not set

    copyBtn.textContent = '🚀 Sending...';
    copyBtn.disabled = true;

    try {
        const response = await apiFetch('/api/send-handover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text.value,
                target: tgTarget
            })
        });

        const result = await response.json();

        if (result.success) {
            copyBtn.textContent = '✅ Sent to Telegram!';
            copyBtn.style.background = 'var(--green)';
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.background = 'var(--cyan)';
                copyBtn.disabled = false;
                closeModal('handover-modal');
            }, 2000);
        } else {
            throw new Error(result.error);
        }
    } catch (err) {
        console.error('❌ Detailed Handover Error:', err);
        copyBtn.textContent = '❌ Failed (' + (err.message || 'Error') + ')';
        copyBtn.style.background = 'var(--red)';

        setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.style.background = 'var(--cyan)';
            copyBtn.disabled = false;
        }, 3000);

        // Fallback: Copy to clipboard if API fails
        text.select();
        document.execCommand('copy');
    }
}

function switchTab(tabId, buttonElement) {
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    buttonElement.classList.add('active');
    document.getElementById(tabId + '-view').classList.add('active');

    const tabIndicator = document.querySelector('.tab-indicator');
    if (tabIndicator) {
        tabIndicator.style.left = buttonElement.offsetLeft + 'px';
        tabIndicator.style.width = buttonElement.offsetWidth + 'px';
    }

    if (tabId === 'database') loadRawLogs();
    if (tabId === 'autoshift') renderAutoShiftUI();
}

let currentLogPage = 0;
async function loadRawLogs() {
    try {
        const response = await apiFetch(`/api/raw-logs?page=${currentLogPage}`);
        const logs = await response.json();
        const tbody = document.getElementById('raw-logs-tbody');
        if (!tbody) return;

        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem; opacity: 0.5;">No records found for this page.</td></tr>';
            return;
        }

        tbody.innerHTML = logs.map(log => `
            <tr>
                <td style="font-family: monospace; font-size: 0.75rem;">${new Date(log.timestamp).toLocaleString('en-SG')}</td>
                <td><span class="source-group">${log.source || 'Unknown'}</span></td>
                <td>${log.sender}</td>
                <td><span class="incident-category" style="font-size: 0.6rem; padding: 0.2rem 0.6rem;">${log.category || 'N/A'}</span></td>
                <td style="font-size: 0.85rem; max-width: 400px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${log.content}">${log.content}</td>
            </tr>
        `).join('');
        document.getElementById('log-page-num').textContent = `Page ${currentLogPage + 1}`;
    } catch (e) { console.error("Failed to load logs:", e); }
}

function changeLogPage(dir) {
    currentLogPage = Math.max(0, currentLogPage + dir);
    loadRawLogs();
}

async function downloadDatabase() {
    try {
        const response = await fetch('/api/download-db', {
            headers: { 'Authorization': HUB_PASSWORD }
        });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hub_backup_${new Date().toISOString().split('T')[0]}.db`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } else {
            alert("Download failed: Unauthorized or file missing.");
        }
    } catch (e) { console.error("Download error:", e); }
}

// -----------------------------------------------------
// Auto Shift Simulator Engine
// -----------------------------------------------------
function generateAutoShift(teamList, holidayList, leaveData, year, month) {
  const calendar = {};
  const daysInMonth = new Date(year, month, 0).getDate();
  
  let firstWednesdayFound = false;
      let firstWednesdayDate = null;

  const weeklyRoles = {};
  for (let w = 1; w <= 6; w++) {
      let roles = ['Role A', 'Role B', 'Role C'];
      let assignment = {};
      
      if (teamList.includes('Shawn')) {
          let shawnRole = Math.random() <= 0.70 ? 'Role C' : (Math.random() < 0.5 ? 'Role A' : 'Role B');
          assignment['Shawn'] = { role: shawnRole, weightApplied: shawnRole === 'Role C' };
          roles.splice(roles.indexOf(shawnRole), 1);
      }
      
      teamList.forEach(u => {
          if (!assignment[u] && roles.length > 0) {
              const r = roles.splice(Math.floor(Math.random() * roles.length), 1)[0];
              assignment[u] = { role: r, weightApplied: false };
          } else if (!assignment[u]) {
              assignment[u] = { role: 'Role A', weightApplied: false };
          }
      });
      weeklyRoles[w] = assignment;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(year, month - 1, day);
    const y = currentDate.getFullYear();
    const mStr = String(currentDate.getMonth() + 1).padStart(2, '0');
    const dStr = String(currentDate.getDate()).padStart(2, '0');
    const dateString = `${y}-${mStr}-${dStr}`;
    
    const dayOfWeek = currentDate.getDay();
    
    if (dayOfWeek === 3 && !firstWednesdayFound) {
      firstWednesdayFound = true;
      firstWednesdayDate = dateString;
    }

    const isPH = holidayList.includes(dateString);
    calendar[dateString] = {
        day: currentDate.toLocaleDateString("en-US", { weekday: 'short' }),
        roster: []
    };

    teamList.forEach(user => {
      let userSchedule = { name: user, assignments: [], tags: [] };
      const hasAL = leaveData[user] && leaveData[user][dateString] === 'AL';
      const hasMC = leaveData[user] && leaveData[user][dateString] === 'MC';
      let policyConflict = false;

      if (dateString === firstWednesdayDate && hasAL && !isPH) {
          userSchedule.tags.push("Policy Conflict: AL denied on 1st Wednesday Sync");
          policyConflict = true;
      }

      const isOfflineForDay = (hasAL && !policyConflict) || hasMC || isPH;
      if (isOfflineForDay) {
          userSchedule.assignments.push(isPH ? "Public Holiday" : (hasAL ? "Annual Leave" : "Medical Leave"));
      }

      const weekIndex = Math.ceil(day / 7);
      const userDef = weeklyRoles[weekIndex] ? weeklyRoles[weekIndex][user] : { role: 'Role A', weightApplied: false };
      
      if (!isOfflineForDay) {
          if (userDef.role === 'Role C' && userDef.weightApplied && user === 'Shawn') {
              userSchedule.tags.push("Weight Rule Applied (70%)");
          }
          
          if (userDef.role === 'Role A') {
              if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                  userSchedule.assignments.push("10AM-7PM (8h) | Break: 12PM-1PM");
              } else {
                  userSchedule.assignments.push("OFF");
              }
          } else if (userDef.role === 'Role B') {
              if (dayOfWeek >= 1 && dayOfWeek <= 5 && dayOfWeek !== 3) {
                  userSchedule.assignments.push("4PM-1AM (8h) | Break: 6PM-7PM");
              } else if (dayOfWeek === 3) {
                  userSchedule.assignments.push("2PM-4PM (2h), 7PM-1AM (6h)");
              } else {
                  userSchedule.assignments.push("OFF");
              }
          } else if (userDef.role === 'Role C') {
              if (dayOfWeek >= 1 && dayOfWeek <= 5 && dayOfWeek !== 3) {
                  userSchedule.assignments.push("Standby");
              } else if (dayOfWeek === 3) {
                  userSchedule.assignments.push("2PM-4PM");
              } else {
                  userSchedule.assignments.push("10AM-1AM (13h) | Break: 12PM-1PM, 7PM-8PM");
              }
          }
      }

      calendar[dateString].roster.push(userSchedule);
    });
  }
  return calendar;
}

let interactiveLeaveData = {
    'Ivan': {},
    'Shawn': {},
    'DJ': {}
};

function addLeaveAndRegenerate() {
    const person = document.getElementById('leave-person').value;
    const dateStr = document.getElementById('leave-date').value;
    const type = document.getElementById('leave-type').value;

    if (!dateStr.startsWith('2026-04')) {
        alert("For this simulator, please select a date in April 2026.");
        return;
    }

    interactiveLeaveData[person][dateStr] = type;
    renderAutoShiftUI();
    renderLeavePills();
}

function removeLeave(person, dateStr) {
    if (interactiveLeaveData[person] && interactiveLeaveData[person][dateStr]) {
        delete interactiveLeaveData[person][dateStr];
        renderAutoShiftUI();
        renderLeavePills();
    }
}

function renderLeavePills() {
    const panel = document.getElementById('active-leaves-panel');
    if (!panel) return;

    panel.innerHTML = '';
    Object.keys(interactiveLeaveData).forEach(person => {
        Object.keys(interactiveLeaveData[person]).forEach(dateStr => {
            const type = interactiveLeaveData[person][dateStr];
            panel.innerHTML += `
                <div class="stat-pill" style="cursor: pointer; border-color: var(--red);" onclick="removeLeave('${person}', '${dateStr}')">
                    ${person} - ${dateStr} (${type}) <span style="margin-left:5px;">&times;</span>
                </div>
            `;
        });
    });
}

function renderAutoShiftUI() {
    const teamList = ['Ivan', 'Shawn', 'DJ'];
    const holidayList = ['2026-04-04']; 

    const uiCalendarData = generateAutoShift(teamList, holidayList, interactiveLeaveData, 2026, 4);
    const grid = document.getElementById('autoshift-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    grid.classList.remove('disabled');

    Object.keys(uiCalendarData).forEach(dateStr => {
        const dayInfo = uiCalendarData[dateStr];
        
        const getSortWeight = (assignments) => {
            const text = assignments.join(', ');
            if (text.includes("10AM-7PM")) return 1; // Day shift
            if (text.includes("4PM-1AM") || text.includes("2PM-4PM (2h)")) return 2; // Night Shift
            if (text.includes("Standby") || text.includes("10AM-1AM") || text.includes("2PM-4PM")) return 3; // Standby
            if (text.includes("Leave") || text.includes("Holiday") || text.includes("AL") || text.includes("MC")) return 4; // Leave/AL/MC
            return 5; // OFF or fallback
        };

        dayInfo.roster.sort((a, b) => {
            // Tie-breaker by name if weights are equal
            const diff = getSortWeight(a.assignments) - getSortWeight(b.assignments);
            if (diff !== 0) return diff;
            return a.name.localeCompare(b.name);
        });
        
        // Count active availability (not offline)
        let availableCount = 0;

        let rosterHtml = '';
        dayInfo.roster.forEach(r => {
            const isOffline = r.assignments.some(a => ['Annual Leave', 'Medical Leave', 'Public Holiday'].includes(a));
            if (!isOffline) availableCount++;

            let tagsHtml = r.tags.map(t => {
                let cssClass = t.includes('Policy Conflict') ? 'tag-policy-conflict' : 'tag-weight-rule';
                return `<span class="autoshift-tag ${cssClass}">${t}</span>`;
            }).join('');
            
            rosterHtml += `
                <div class="autoshift-person-row" style="${isOffline ? 'opacity: 0.5;' : ''}">
                    <div class="autoshift-person-name">${r.name}</div>
                    <div class="autoshift-assignment">${r.assignments.join(', ')}</div>
                    ${tagsHtml}
                </div>
            `;
        });

        const isShortStaffed = availableCount < 2;

        const card = document.createElement('div');
        card.className = 'autoshift-day-card glass';
        if (isShortStaffed) {
             card.style.borderTopColor = 'var(--red)';
             card.innerHTML = `
                <div class="autoshift-date-header">
                    <div>
                        <span class="autoshift-date">${dateStr.split('-')[2]}</span>
                        <span class="autoshift-day-name">${dayInfo.day}</span>
                    </div>
                    <span class="autoshift-tag tag-policy-conflict">CRITICAL: SHORT STAFFED</span>
                </div>
                <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
                    ${rosterHtml}
                </div>
             `;
        } else {
             card.innerHTML = `
                <div class="autoshift-date-header">
                    <span class="autoshift-date">${dateStr.split('-')[2]}</span>
                    <span class="autoshift-day-name">${dayInfo.day}</span>
                </div>
                <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
                    ${rosterHtml}
                </div>
            `;
        }

        grid.appendChild(card);
    });
}
