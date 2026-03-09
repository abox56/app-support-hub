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

    let time = 3 * 3600 + 42 * 60 + 15; // 03:42:15 in seconds

    setInterval(() => {
        time--;
        if (time < 0) time = 8 * 3600; // Reset to 8h if reached zero

        const h = Math.floor(time / 3600);
        const m = Math.floor((time % 3600) / 60);
        const s = time % 60;

        timerElement.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }, 1000);
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
    loadSettings(); // Load Telegram link
    // Simulate new events every 2 minutes
    setInterval(simulateNewEvent, 120000);
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
        document.getElementById('theme-icon-dark').style.display = savedTheme === 'light' ? 'none' : 'block';
        document.getElementById('theme-icon-light').style.display = savedTheme === 'light' ? 'block' : 'none';
    });
}

function initTimeline() {
    const events = [
        { type: 'info', content: 'SMI Node-B latency stabilized', time: '10:15' },
        { type: 'success', content: 'Pragmatic Play #PP-8821 Resolved', time: '11:30' },
        { type: 'critical', content: 'Evolution Stream alert: Packet loss', time: '14:20' }
    ];

    events.forEach(ev => addTimelineEvent(ev.type, ev.content, ev.time));
}

function addTimelineEvent(type, content, time) {
    const feed = document.getElementById('timeline-feed');
    if (!feed) return;

    // Remove "empty" message if it exists
    const emptyMsg = feed.querySelector('.timeline-empty');
    if (emptyMsg) emptyMsg.remove();

    const eventTime = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const item = document.createElement('div');
    item.className = `timeline-item ${type}`;
    item.innerHTML = `
        <div class="timeline-time">${eventTime}</div>
        <div class="timeline-content">${content}</div>
    `;

    feed.prepend(item);

    // Keep only last 10 events
    if (feed.children.length > 10) {
        feed.removeChild(feed.lastChild);
    }
}

function simulateNewEvent() {
    const types = ['info', 'success', 'critical'];
    const contents = [
        'Routine heartbeat check passed',
        'Cache cleared on secondary node',
        'API latency spike detected',
        'New ticket #TS-404 created',
        'Node-A memory utilization at 85%'
    ];

    const randomType = types[Math.floor(Math.random() * types.length)];
    const randomContent = contents[Math.floor(Math.random() * contents.length)];

    addTimelineEvent(randomType, randomContent);
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
        const response = await fetch('/api/send-handover', {
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
        console.error('Failed to send:', err);
        copyBtn.textContent = '❌ Failed to Send';
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
