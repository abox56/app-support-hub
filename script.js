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
    loadSettings(); // Load Telegram link
});

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

function updateActivePIC(roster) {
    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDay = dayNames[now.getDay()];
    const currentHour = now.getHours();

    let shiftType = 'Early'; // default
    if (currentHour >= 18 || currentHour < 2) shiftType = 'Late';
    else if (currentHour >= 10 && currentHour < 18) shiftType = 'Early';
    else shiftType = 'Utility / Wkend'; // 2am to 10am is technically utility or gap

    const row = roster.find(r => r.rowLabel.includes(shiftType));
    if (row) {
        const dayIdx = (now.getDay() + 6) % 7; // Mon is 0
        const pic = row.shifts[dayIdx];
        const picElement = document.getElementById('current-pic');
        if (picElement) picElement.textContent = pic || '--';
    }
}

async function initRoster() {
    try {
        const response = await apiFetch('/api/roster');
        const roster = await response.json();
        const grid = document.getElementById('roster-grid');
        if (!grid) return;

        // Keep headers, clear the rest
        const headers = Array.from(grid.querySelectorAll('.matrix-header'));
        grid.innerHTML = '';
        headers.forEach(h => grid.appendChild(h));

        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        roster.forEach(row => {
            const labelDiv = document.createElement('div');
            labelDiv.className = 'matrix-row-label';
            labelDiv.innerHTML = `${row.rowLabel}<br/><span>${row.timeLabel}</span>`;
            grid.appendChild(labelDiv);

            row.shifts.forEach((shiftText, index) => {
                const shiftDiv = document.createElement('div');
                shiftDiv.className = 'shift-card';
                if (shiftText === '-') shiftDiv.classList.add('off-day');
                if (shiftText.includes('KNOWLEDGE UPGRADE')) shiftDiv.classList.add('knowledge-wednesday');
                if (row.rowLabel === 'Early' && days[index] === 'Mon') shiftDiv.classList.add('peak-window');
                if (row.rowLabel === 'Early' && days[index] === 'Tue') shiftDiv.classList.add('selected-active');

                shiftDiv.setAttribute('data-day', days[index]);
                shiftDiv.innerHTML = shiftText;
                grid.appendChild(shiftDiv);
            });
        });

        updateActivePIC(roster);
    } catch (err) {
        console.error('Failed to load roster:', err);
    }
}

async function initTimeline() {
    checkAccess();
    try {
        const response = await apiFetch('/api/incidents');
        const incidents = await response.json();

        const feed = document.getElementById('timeline-feed');
        if (feed) feed.innerHTML = ''; // Clear hardcoded ones

        incidents.forEach(ev => {
            const dateObj = new Date(ev.last_update || ev.first_timestamp || ev.timestamp);
            const isToday = dateObj.toDateString() === new Date().toDateString();
            const dateStr = isToday ? 'Today' : dateObj.toLocaleDateString([], { day: '2-digit', month: 'short' });
            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const combinedTime = `${dateStr} ${timeStr}`;

            addTimelineEvent(ev.category.toLowerCase().includes('smi') ? 'info' :
                ev.category.toLowerCase().includes('provider') ? 'critical' : 'success',
                ev.main_content || ev.content,
                combinedTime,
                ev.category,
                ev.source,
                ev.updates); // NEW: Pass updates
        });

        updateStatPills(incidents);
        renderAnalytics(incidents); // NEW: Render charts
        const countElement = document.getElementById('active-incidents-count');
        if (countElement) countElement.textContent = incidents.filter(i => i.status === 'Active' || i.status === 'Captured' || i.status === 'In Progress').length;
    } catch (err) {
        console.error('Failed to load incidents:', err);
    }
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

function addTimelineEvent(type, content, time, category = '', source = '', updates = []) {
    const feed = document.getElementById('timeline-feed');
    if (!feed) return;

    // Remove "empty" message if it exists
    const emptyMsg = feed.querySelector('.timeline-empty');
    if (emptyMsg) emptyMsg.remove();

    const eventTime = time || "Just Now";
    const updateCount = updates.length > 1 ? `<span class="update-badge">${updates.length} msgs</span>` : '';

    const item = document.createElement('div');
    item.className = `timeline-item ${type}`;
    item.innerHTML = `
        <div class="timeline-time">${eventTime}</div>
        <div class="timeline-content">
            <div class="timeline-header-row">
                <span class="event-tag">${category || 'OPS'}</span>
                ${updateCount}
            </div>
            <span class="source-tag">${source ? 'via ' + source : ''}</span>
            <p>${content}</p>
            ${updates.length > 1 ? `
                <div class="thread-preview">
                    <span class="thread-line"></span>
                    <p class="thread-last">Last update: ${updates[updates.length-1].content.substring(0, 40)}...</p>
                </div>
            ` : ''}
        </div>
    `;

    feed.prepend(item);

    // Keep history
    if (feed.children.length > 50) {
        feed.removeChild(feed.lastChild);
    }
}

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

    // Gather Live Data from Timeline
    const timelineItems = Array.from(document.querySelectorAll('.timeline-item')).slice(0, 5);
    const incidents = timelineItems.map(item => {
        let icon = '🔹';
        if (item.classList.contains('critical')) icon = '🔴';
        if (item.classList.contains('success')) icon = '✅';
        return `${icon} ${item.querySelector('.timeline-content').textContent}`;
    }).join('\n');

    // Gather Data from Ticketing
    const ticketingRows = Array.from(document.querySelectorAll('.ticketing-table tbody tr')).slice(0, 3);
    const tickets = ticketingRows.map(row => {
        const cols = row.querySelectorAll('td');
        const status = cols[4].textContent.trim();
        let icon = '🔍';
        if (status === 'Resolved' || status === 'Fixed') icon = '✅';
        if (status === 'Pending') icon = '⏳';
        return `${icon} ${cols[0].textContent}: ${cols[1].textContent} (${status})`;
    }).join('\n');

    const summary = `🚀 *APP SUPPORT HANDOVER* 🚀
📅 Date: ${dateStr} | 🕒 Time: ${timeStr}
👤 Outgoing PIC: ${picName}

---
🔥 *RECENT INCIDENTS & UPDATES*
${incidents || 'No major incidents reported.'}

---
🎫 *TICKET STATUS*
${tickets || 'No active tickets.'}

---
📊 *SYSTEM HEALTH*
✅ SLA: STABLE
✅ Monitoring: SMI Persistent

---
🔗 *Quick Link:* [SMI Monitoring](https://smi.bigbull99.com)
cc: @App_Sup_Team`;

    const handoverText = document.getElementById('handover-text');
    if (handoverText) {
        handoverText.value = summary;
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
    // Remove active class from all buttons and contents
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // Add active class to clicked button and target content
    buttonElement.classList.add('active');
    document.getElementById(tabId + '-view').classList.add('active');

    // Update tab indicator position and width
    const tabIndicator = document.querySelector('.tab-indicator');
    if (tabIndicator) {
        tabIndicator.style.left = buttonElement.offsetLeft + 'px';
        tabIndicator.style.width = buttonElement.offsetWidth + 'px';
    }
}
