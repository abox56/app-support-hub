let HUB_PASSWORD = localStorage.getItem('hub_access_token') || '';
let ALL_INCIDENTS = []; // Global cache for detailed view
let PUBLIC_HOLIDAYS = []; // Cache for calendar highlighting

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

async function updateHolidayCountdown() {
    const timerElement = document.getElementById('holiday-timer');
    if (!timerElement) return;

    try {
        const response = await apiFetch('/api/config/holidays');
        const holidays = await response.json();
        
        const now = new Date();
        const futureHolidays = holidays
            .map(h => ({ ...h, date: new Date(h.holiday_date) }))
            .filter(h => h.date >= now)
            .sort((a, b) => a.date - b.date);

        if (futureHolidays.length > 0) {
            const next = futureHolidays[0];
            const diff = next.date - now;
            const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
            timerElement.textContent = `${days} Days`;
            
            // Optional: update label to show holiday name
            const label = document.querySelector('.vibe-card:has(#holiday-timer) .vibe-label');
            if (label) label.textContent = `Next Holiday: ${next.name}`;
            return;
        }
    } catch (e) { console.error("Holiday countdown error:", e); }

    // Fallback if no holidays defined in DB
    const now = new Date();
    const currentYear = now.getFullYear();
    let nextHoliday = new Date(currentYear, 4, 1); // May 1st
    if (now > nextHoliday) nextHoliday = new Date(currentYear, 11, 25);
    if (now > nextHoliday) nextHoliday = new Date(currentYear + 1, 4, 1);

    const diff = nextHoliday - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    timerElement.textContent = `${days} Days`;
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
    loadAdminData();

    // Maintenance
    setInterval(checkPulse, 30000); // Check every 30s
    
    // Poll for new incidents every 30 seconds
    setInterval(initTimeline, 30000);
    setInterval(checkTGStatus, 60000); // 1 min check for TG
});

function checkPulse() {
    const now = new Date();
    const hr = now.getHours();
    const mn = now.getMinutes();
    
    // 10:25 AM Pulse Reminder
    if (hr === 10 && mn === 25) {
        const pulseAlert = document.getElementById('pulse-alert');
        if (pulseAlert) {
            pulseAlert.querySelector('.alert-text').textContent = "⚠️ REMINDER (Ivan): 10:30 AM Pulse Check-in required.";
            pulseAlert.style.display = 'block';
        }
    } else if (hr === 10 && mn >= 30 && mn < 45) {
        const pulseAlert = document.getElementById('pulse-alert');
        if (pulseAlert) {
            pulseAlert.querySelector('.alert-text').textContent = "🚀 PULSE ACTIVE: Ivan locked as Lead PIC.";
            pulseAlert.style.display = 'block';
        }
    }
}

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
        // Enforce 10:30 Pulse Lock
        const hr = now.getHours();
        const mn = now.getMinutes();
        if (hr === 10 && mn >= 30 && mn < 45) {
             const picElement = document.getElementById('current-pic');
             if (picElement) picElement.textContent = 'Ivan (Locked PIC for Pulse) (Active)';
             return;
        }

        // Shawn Weekend Override: He is active 10:00-01:00 on Sat/Sun
        if ((currentDay === 'Saturday' || currentDay === 'Sunday') && week.title.includes('Week 1')) {
            if (currentHour >= 10 || currentHour < 1) {
                const picElement = document.getElementById('current-pic');
                if (picElement) picElement.textContent = 'Shawn (Active)';
                return;
            }
        }

        const shift = week.days[currentDay] ? week.days[currentDay][rowIndex] : null;
        if (!shift) return;
        
        const activePeople = [];
        const people = ['Ivan', 'Shawn', 'DJ'];
        
        people.forEach(person => {
            const status = shift[person];
            if (status && status !== 'Rest Day' && status !== 'AL' && status !== 'PH' && !status.includes('office close')) {
                if (status.trim() === '✓' || status.trim() === ' ' || status.trim() === '') {
                    activePeople.push(person);
                } else {
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
let currentView = 'week';

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
    if (!allWeeks || allWeeks.length === 0) return 0;
    
    const targetTime = date.getTime();

    for (let i = 0; i < allWeeks.length; i++) {
        const week = allWeeks[i];
        if (!week.dateRange) continue;
        
        let startEnd = week.dateRange.split('-');
        if (startEnd.length !== 2) continue;
        
        // Extract year from title like "Jan26 Week1"
        const yearMatch = week.title.match(/[A-Za-z]+(\d{2})/);
        const year = yearMatch ? 2000 + parseInt(yearMatch[1]) : date.getFullYear();

        let startStr = startEnd[0].replace(/([a-zA-Z]+)/, ' $1 ') + year;
        let endStr = startEnd[1].replace(/([a-zA-Z]+)/, ' $1 ') + year;
        
        let startDate = new Date(startStr);
        let endDate = new Date(endStr);
        
        // Handle Dec to Jan transition overlap
        if (startDate.getMonth() === 11 && endDate.getMonth() === 0) {
            endDate.setFullYear(year + 1);
        }
        
        endDate.setHours(23, 59, 59, 999);
        
        if (targetTime >= startDate.getTime() && targetTime <= endDate.getTime()) {
            return i;
        }
    }
    
    // Fallback if not found: try matching "Mar26" or similar
    const monthShort = date.toLocaleString('en-US', { month: 'short' });
    const yearShort = date.getFullYear().toString().slice(2);
    const fallbackMonthStr = monthShort + yearShort;
    
    const fallbackIndex = allWeeks.findIndex(w => w.title.includes(fallbackMonthStr));
    return fallbackIndex !== -1 ? fallbackIndex : 0;
}

function renderWeek(index) {
    if (index < 0 || index >= allWeeks.length) return;
    currentWeekIndex = index;
    
    const week = allWeeks[index];
    document.getElementById('current-week-label').textContent = week.title;

    const grid = document.getElementById('roster-grid');
    if (!grid) return;

    // Time Bank Calculation for Shawn (Week 1 Spec)
    let shawnHours = 0;
    if (week.title.includes("Week 1")) {
        shawnHours = 40; // Hardcoded calculation based on spec: 2 + 6 + 6 + 13 + 13
    }

    // Parse starting date to show dates in headers
    let startDate = new Date();
    try {
        const startPart = week.dateRange.split('-')[0];
        const dayNum = parseInt(startPart.substring(0, 2));
        const monthStr = startPart.substring(2);
        startDate = new Date(`${dayNum} ${monthStr} 2026`);
    } catch(e) {}

    const dayHeaders = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    let headerHtml = `<div class="matrix-header">Shift</div>`;
    dayHeaders.forEach((abbr, i) => {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
        const isWed = i === 2;
        headerHtml += `
            <div class="matrix-header ${isWed ? 'knowledge-wednesday-header' : ''}" style="font-weight: 800; color: #FFFFFF;">
                ${abbr} <span style="font-size: 0.85rem; color: var(--cyan); font-weight: 700; margin-left: 6px;">${dateStr}</span> ${isWed ? '✽' : ''}
            </div>`;
    });
    grid.innerHTML = headerHtml;

    const dayKeys = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let maxRows = 0;
    if (week.days) {
        dayKeys.forEach(d => { if(week.days[d] && week.days[d].length > maxRows) maxRows = week.days[d].length; });
    }
    // Ensure Remark row (row 4) is always accounted for
    if (maxRows < 4) maxRows = 4;

    if (maxRows === 0) {
        grid.innerHTML += `<div style="grid-column: span 8; padding: 2rem; text-align: center; opacity: 0.5;">No shifts found for ${week.title}</div>`;
        return;
    }

    for (let r = 0; r < maxRows; r++) {
        // Find a representative shift for this row to get the label/time
        let repShift = null;
        for(let d of dayKeys) { if(week.days[d] && week.days[d][r]) { repShift = week.days[d][r]; break; } }
        
        let labelTitle = '';
        if (r === 0) labelTitle = 'Early';
        else if (r === 1) labelTitle = 'Night';
        else if (r === 2) labelTitle = 'Backup';
        else labelTitle = 'Remark';

        const labelDiv = document.createElement('div');
        labelDiv.className = 'matrix-row-label';
        
        // Find time label for this row
        let timeLabel = (repShift && labelTitle !== 'Remark') ? repShift.time : '';
        if (r === 1 && !timeLabel) {
            timeLabel = "16:00-01:00"; // Default Night display if not explicitly in JSON
        }
        
        labelDiv.innerHTML = `${labelTitle}<br/><span>${timeLabel}</span>`;
        grid.appendChild(labelDiv);

        dayKeys.forEach(day => {
            let shift = (week.days[day] && week.days[day][r]) ? week.days[day][r] : null;
            
            // WEEKEND OVERRIDE: Mirror the primary weekend shift (Row 0) to the Night row for visual continuity
            if (labelTitle === 'Night' && (day === 'Saturday' || day === 'Sunday')) {
                const weekendShift = (week.days[day] && week.days[day][0]) ? week.days[day][0] : null;
                if (weekendShift) shift = weekendShift;
            }

            const shiftDiv = document.createElement('div');
            shiftDiv.className = 'shift-card';
            
            // ADMIN INTERACTION: Allow clicking to swap if admin
            if (labelTitle !== 'Remark' && shift && currentView === 'week') {
                shiftDiv.classList.add('admin-clickable');
                shiftDiv.onclick = () => openShiftSwap(day, r, shift, week.title);
            }

            // Visual indicator for swapped shifts
            if (shift && shift.swapped) {
                shiftDiv.classList.add('swapped-shift');
            }

            if (shift || labelTitle === 'Remark') {
                let content = '';
                
                // DJ: AL REMARK OVERRIDE: Move to Remark row
                if (labelTitle === 'Remark' && (day === 'Thursday' || day === 'Friday') && week.title.includes('Week 1')) {
                    content += `<span class="away-badge">DJ: AL</span>`;
                }

                if (shift) {
                    if (day === 'Wednesday' && shift.note === 'Weekly Sync Meeting') {
                        shiftDiv.classList.add('sync-band');
                    }

                    const ivan = shift.Ivan;
                    const shawn = shift.Shawn;
                    const dj = shift.DJ;

                    // Skip showing DJ: AL in the original Backup row
                    if (dj === 'AL' && labelTitle !== 'Remark') {
                        // Don't add to content here, handled in Remark row
                    } else if (dj === 'AL') {
                        content += `<span class="away-badge">DJ: AL</span>`;
                    }

                    if (labelTitle !== 'Remark') {
                        if (shawn && typeof shawn === 'string' && shawn.includes('Offset')) {
                            content += `<div class="offset-shift-box">Shawn: 19:00-01:00</div>`;
                        } else if (shawn && shawn !== 'Rest Day' && shawn !== 'AL') {
                             content += (content ? ' / ' : '') + 'Shawn';
                        }

                        if (ivan && ivan !== 'Rest Day' && ivan !== 'AL') {
                             content += (content ? ' / ' : '') + 'Ivan';
                        }
                        
                        if (dj && dj !== 'Rest Day' && dj !== 'AL') {
                             content += (content ? ' / ' : '') + 'DJ';
                        }
                    }


                    // Render custom notes (used by shift swap)
                    if (shift.note && labelTitle === 'Remark') {
                        // Skip rendering 'Weekly Sync Meeting' as text because the CSS .sync-band adds it as a badge
                        if (shift.note !== 'Weekly Sync Meeting') {
                            content += (content ? ' / ' : '') + `<span class="remark-text">${shift.note}</span>`;
                        }
                    }
                }

                if (!content || (typeof content === 'string' && content.includes('Rest Day'))) {
                    shiftDiv.classList.add('off-day');
                }
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
    currentView = view;
    const weekGrid = document.getElementById('roster-grid');
    const monthView = document.getElementById('month-view');
    const sidebar = document.getElementById('month-stats-sidebar');
    const toggleWeek = document.getElementById('toggle-week');
    const toggleMonth = document.getElementById('toggle-month');

    if (view === 'week') {
        weekGrid.style.display = 'grid';
        monthView.style.display = 'none';
        if (sidebar) sidebar.style.display = 'none';
        toggleWeek.classList.add('active');
        toggleMonth.classList.remove('active');
    } else {
        weekGrid.style.display = 'none';
        monthView.style.display = 'block';
        if (sidebar) sidebar.style.display = 'flex';
        toggleWeek.classList.remove('active');
        toggleMonth.classList.add('active');
        renderMonthView();
    }
}

function renderMonthView() {
    const container = document.getElementById('month-view');
    const sidebar = document.getElementById('month-stats-sidebar');
    if (!container) return;

    // 1. Calculate Stats
    const stats = { Ivan: 0, Shawn: 0, DJ: 0 };
    let totalShifts = 0;

    allWeeks.forEach(week => {
        Object.values(week.days).forEach(dayShifts => {
            dayShifts.forEach(s => {
                if (s.time && s.time !== 'On-call' && !s.time.includes('OFF')) {
                    if (s.Ivan && s.Ivan !== 'Rest Day' && s.Ivan !== 'AL') { stats.Ivan++; totalShifts++; }
                    if (s.Shawn && s.Shawn !== 'Rest Day' && s.Shawn !== 'AL') { stats.Shawn++; totalShifts++; }
                    if (s.DJ && s.DJ !== 'Rest Day' && s.DJ !== 'AL') { stats.DJ++; totalShifts++; }
                }
            });
        });
    });

    // 2. Render Calendar Grid
    let html = `
        <div class="month-grid-header">
            <h3 class="month-title">Monthly Overview (2026)</h3>
        </div>
        <div class="month-calendar-grid">
            <div class="month-day-header">Mon</div>
            <div class="month-day-header">Tue</div>
            <div class="month-day-header">Wed</div>
            <div class="month-day-header">Thu</div>
            <div class="month-day-header">Fri</div>
            <div class="month-day-header">Sat</div>
            <div class="month-day-header">Sun</div>
    `;

    allWeeks.forEach((week, weekIdx) => {
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        
        // Calculate the starting date of this week from week.dateRange ("30Mar-05Apr")
        let startDate = new Date(); // Fallback
        try {
            const startPart = week.dateRange.split('-')[0]; // "30Mar"
            const dayNum = parseInt(startPart.substring(0, 2));
            const monthStr = startPart.substring(2);
            startDate = new Date(`${dayNum} ${monthStr} 2026`);
        } catch(e) {}

        days.forEach((dayName, dayIdx) => {
            const dayShifts = week.days[dayName] || [];
            
            // Calculate actual date for this cell
            const cellDate = new Date(startDate);
            cellDate.setDate(startDate.getDate() + dayIdx);
            const dateDisplay = `${cellDate.getDate()}/${cellDate.getMonth() + 1}`;

            // Extract personnel for this day
            const dayShiftPeople = [];
            const nightShiftPeople = [];
            let isAL = false;
            let note = '';
            
            dayShifts.forEach(s => {
                const isNight = s.time && (s.time.includes('16:00') || s.time.includes('19:00'));
                if (s.time !== 'On-call' && !s.time.includes('OFF')) {
                    if (s.Ivan && s.Ivan !== 'Rest Day' && s.Ivan !== 'AL') { if(isNight) nightShiftPeople.push('Ivan'); else dayShiftPeople.push('Ivan'); }
                    if (s.Shawn && s.Shawn !== 'Rest Day' && s.Shawn !== 'AL') { if(isNight) nightShiftPeople.push('Shawn'); else dayShiftPeople.push('Shawn'); }
                    if (s.DJ && s.DJ !== 'Rest Day' && s.DJ !== 'AL') { if(isNight) nightShiftPeople.push('DJ'); else dayShiftPeople.push('DJ'); }
                }
                if (s.DJ === 'AL' || s.Ivan === 'AL' || s.Shawn === 'AL') isAL = true;
                if (s.note && s.note !== 'Weekly Sync Meeting') note = s.note;
            });

            html += `
                <div class="month-day-cell glass ${isAL ? 'has-al' : ''}" onclick="renderWeek(${weekIdx}); toggleRosterView('week')">
                    <div class="month-date-num" style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.65rem; opacity:0.6;">${dayName.substring(0,3)}</span>
                        <span style="color:var(--cyan);">${dateDisplay}</span>
                    </div>
                    
                    <div class="month-shift-pills">
                        ${[...new Set(dayShiftPeople)].map(p => `<span class="mini-pill ${p.toLowerCase()}" title="Early">${p}</span>`).join('')}
                    </div>
                    
                    ${nightShiftPeople.length > 0 ? `
                    <div class="month-shift-pills" style="border-top: 1px solid rgba(255,255,255,0.05); padding-top:4px; margin-top:2px;">
                        ${[...new Set(nightShiftPeople)].map(p => `<span class="mini-pill ${p.toLowerCase()}" title="Night" style="opacity:0.8; font-style:italic;">${p}</span>`).join('')}
                    </div>` : ''}

                    ${isAL ? `<div class="month-holiday-badge">AL/MC</div>` : ''}
                </div>
            `;
        });
    });

    html += `</div>`;
    container.innerHTML = html;

    // 3. Render Sidebar Stats
    if (sidebar) {
        const max = Math.max(stats.Ivan, stats.Shawn, stats.DJ, 1);
        sidebar.innerHTML = `
            <div class="stats-card glass" style="margin-bottom: 1rem;">
                <h4>Legend</h4>
                <div class="stat-row" style="margin-bottom: 0.5rem;">
                    <span class="mini-pill" style="background: rgba(255,255,255,0.1); color: white;">Name</span>
                    <span style="font-size: 0.75rem; opacity: 0.7;">Day Shift</span>
                </div>
                <div class="stat-row">
                    <span class="mini-pill" style="background: rgba(255,255,255,0.05); color: white; border: 1px dashed rgba(255,255,255,0.2); font-style: italic; opacity: 0.8;">Name</span>
                    <span style="font-size: 0.75rem; opacity: 0.7;">Night Shift</span>
                </div>
            </div>

            <div class="stats-card glass">
                <h4>Shift Distribution</h4>
                ${Object.entries(stats).map(([name, count]) => `
                    <div class="stat-item">
                        <div class="stat-row">
                            <span>${name}</span>
                            <span>${count} Shifts</span>
                        </div>
                        <div class="stat-bar-bg">
                            <div class="stat-bar-fill ${name.toLowerCase()}" style="width: ${(count/max)*100}%"></div>
                        </div>
                    </div>
                `).join('')}
                <div style="margin-top: 1.5rem; font-size: 0.75rem; opacity: 0.5; text-align: center;">
                    Based on ${allWeeks.length} generated weeks
                </div>
            </div>
        `;
    }
}

// Remove the placeholder function we added earlier at the end of initRoster block


async function initTimeline() {
    try {
        const response = await apiFetch('/api/incidents');
        const incidents = await response.json();
        ALL_INCIDENTS = incidents; // Store for detals view

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
    
    const isAttended = inc.status === 'Attended';
    
    const card = document.createElement('div');
    card.className = `incident-card ${isCritical ? 'critical' : ''} ${isAttended ? 'attended' : ''}`;
    
    const header = `
        <div class="incident-card-header">
            <span class="incident-category">${inc.category || '[GENERAL]'}</span>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
                ${isAttended ? `<span class="status-badge attended">Attended</span>` : ''}
                ${msgCount > 1 ? `<span class="aggregation-counter">x${msgCount} Messages</span>` : ''}
            </div>
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
                <span class="time-ago">Last update at ${timeStr} • ${isAttended ? `Attended by ${inc.assigned_to}` : `Engine: ${inc.engine || 'Unknown'}`}</span>
                <span class="source-group">${inc.source || 'Direct Hub'}</span>
            </div>
            ${isPIC() ? `<button class="notify-btn" onclick="event.stopPropagation(); resolveIncident('${inc.id}')">Resolve</button>` : ''}
        </div>
    `;

    card.innerHTML = header + body + footer;
    
    // Use an attribute for onclick so it survives cloning
    card.setAttribute('onclick', `openIncidentDetails('${inc.id}')`);

    // Add to main dashboard feed
    if (feed) {
        feed.appendChild(card.cloneNode(true));
    }
    
    // Add to ops panel timeline feed(s)
    const timelineFeeds = document.querySelectorAll('.timeline-feed');
    timelineFeeds.forEach(tf => {
        tf.appendChild(card.cloneNode(true));
    });
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

function openIncidentDetails(id) {
    console.log("Opening details for:", id);
    const inc = ALL_INCIDENTS.find(i => String(i.id) === String(id));
    if (!inc) {
        console.error("Incident not found in local cache:", id);
        return;
    }

    document.getElementById('detail-title').textContent = `Incident Thread #${inc.id}`;
    document.getElementById('detail-category').textContent = inc.category || 'General';
    document.getElementById('detail-engine').textContent = `Engine: ${inc.engine || 'Local Keywords'}`;
    document.getElementById('detail-summary').textContent = inc.ai_summary || inc.main_content;
    document.getElementById('detail-msg-count').textContent = inc.updates ? inc.updates.length : 1;

    const list = document.getElementById('detail-messages-list');
    list.innerHTML = '';

    if (inc.updates && inc.updates.length > 0) {
        inc.updates.forEach(msg => {
            const date = new Date(msg.timestamp);
            const timeStr = date.toLocaleString('en-SG', { 
                day: '2-digit', 
                month: 'short', 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit'
            });
            
            const item = document.createElement('div');
            item.className = 'detail-msg-item';
            item.innerHTML = `
                <div class="msg-item-header">
                    <span class="msg-sender">${msg.sender}</span>
                    <span class="msg-time">${timeStr}</span>
                </div>
                <div class="msg-content">${msg.content}</div>
            `;
            list.appendChild(item);
        });
    } else {
        // Fallback for single manual log
        const item = document.createElement('div');
        item.className = 'detail-msg-item';
        item.innerHTML = `
            <div class="msg-item-header">
                <span class="msg-sender">${inc.assigned_to || 'System'}</span>
                <span class="msg-time">${new Date(inc.first_timestamp).toLocaleString('en-SG')}</span>
            </div>
            <div class="msg-content">${inc.main_content}</div>
        `;
        list.appendChild(item);
    }

    // Resolve Button in footer
    const resolveContainer = document.getElementById('detail-resolve-container');
    resolveContainer.innerHTML = '';
    if (isPIC() && inc.status !== 'Resolved') {
        const btn = document.createElement('button');
        btn.className = 'modal-btn primary';
        btn.style.background = 'var(--cyan)';
        btn.style.color = '#000';
        btn.textContent = 'Resolve & Close';
        btn.onclick = () => {
            closeModal('incident-detail-modal');
            resolveIncident(id);
        };
        resolveContainer.appendChild(btn);
    }

    openModal('incident-detail-modal');
}

// Timeline events are now handled by renderIncidentCard


function renderAnalytics(incidents) {
    if (!incidents || incidents.length === 0) return;

    // 1. Shift Radar (Circular 24h Activity)
    const radarContainer = document.getElementById('shift-radar');
    if (radarContainer) {
        const hours = Array(24).fill(0);
        incidents.forEach(i => {
            const date = new Date(i.first_timestamp || i.timestamp || new Date());
            if (!isNaN(date.getTime())) hours[date.getHours()]++;
        });

        radarContainer.innerHTML = '<div class="radar-center">24h HUB</div>';
        const maxVal = Math.max(...hours, 1);

        hours.forEach((count, h) => {
            const angle = (h / 24) * 360;
            const height = (count / maxVal) * 100;
            
            // Spike
            const spike = document.createElement('div');
            spike.className = 'radar-spike';
            spike.style.transform = `rotate(${angle}deg)`;
            spike.style.height = `${height}px`;
            if (count > 0) spike.style.boxShadow = `0 0 5px var(--cyan)`;
            radarContainer.appendChild(spike);

            // Labels for major hours
            if (h % 6 === 0) {
                const label = document.createElement('div');
                label.className = 'radar-label';
                const rad = (angle - 90) * (Math.PI / 180);
                const x = Math.cos(rad) * 115;
                const y = Math.sin(rad) * 115;
                label.style.transform = `translate(${x}px, ${y}px)`;
                label.textContent = `${h.toString().padStart(2, '0')}:00`;
                radarContainer.appendChild(label);
            }
        });
    }

    // 2. Category Source Flow (Sankey Concept)
    const flowContainer = document.getElementById('category-flow');
    if (flowContainer) {
        // Aggregate: Source -> Category
        const sourceCats = {};
        const allCats = new Set();
        const topSources = {};

        incidents.forEach(i => {
            if (i.source === 'Manual Input') return;
            topSources[i.source] = (topSources[i.source] || 0) + 1;
            if (!sourceCats[i.source]) sourceCats[i.source] = {};
            sourceCats[i.source][i.category] = (sourceCats[i.source][i.category] || 0) + 1;
            allCats.add(i.category);
        });

        const sortedSources = Object.entries(topSources).sort((a,b) => b[1] - a[1]).slice(0, 5);
        const catArray = Array.from(allCats);
        const catColors = ['#00f2fe', '#4facfe', '#96e6a1', '#f093fb', '#f5576c', '#f8bbd0'];

        flowContainer.innerHTML = '';
        sortedSources.forEach(([source, total]) => {
            const row = document.createElement('div');
            row.className = 'flow-row';
            
            let ribbonsHtml = '';
            catArray.forEach((cat, idx) => {
                const count = sourceCats[source][cat] || 0;
                const width = (count / total) * 100;
                if (width > 0) {
                    ribbonsHtml += `<div class="flow-ribbon" title="${cat}: ${count}" style="width: ${width}%; background: ${catColors[idx % catColors.length]}"></div>`;
                }
            });

            row.innerHTML = `
                <div class="flow-source" title="${source}">${source.substring(0, 10)}</div>
                <div class="flow-ribbon-container">
                    ${ribbonsHtml}
                </div>
                <div class="flow-target">${total} Total</div>
            `;
            flowContainer.appendChild(row);
        });
    }

    // 3. Day of Week Chart
    const dayContainer = document.getElementById('day-chart');
    if (dayContainer) {
        const days = { 'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0, 'Sat': 0, 'Sun': 0 };
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        incidents.forEach(i => {
            if (i.source === 'Manual Input') return; // Optionally exclude manual
            const date = new Date(i.first_timestamp || i.timestamp || new Date());
            if (!isNaN(date.getTime())) {
                const dayName = dayNames[date.getDay()];
                days[dayName]++;
            }
        });

        dayContainer.innerHTML = '';
        const maxDay = Math.max(...Object.values(days), 1);
        
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(name => {
            const count = days[name];
            const percentage = (count / maxDay) * 100;
            const row = document.createElement('div');
            row.className = 'chart-row';
            row.innerHTML = `
                <div class="chart-label">${name}</div>
                <div class="chart-bar-bg"><div class="chart-bar" style="width: ${percentage}%; background: var(--purple);"></div></div>
                <div class="chart-value">${count}</div>
            `;
            dayContainer.appendChild(row);
        });
    }

    // 4. Hourly Peak Performance Heatmap (NEW)
    const heatmapContainer = document.getElementById('hourly-heatmap');
    if (heatmapContainer) {
        const hours = Array(24).fill(0);
        incidents.forEach(i => {
            const date = new Date(i.first_timestamp || i.timestamp || new Date());
            if (!isNaN(date.getTime())) {
                hours[date.getHours()]++;
            }
        });

        heatmapContainer.innerHTML = '';
        const maxVal = Math.max(...hours, 1);

        hours.forEach((count, h) => {
            const cell = document.createElement('div');
            cell.className = 'heatmap-cell';
            const ratio = count / maxVal;
            
            // Color Logic: From Cool Blue -> Soft Green -> Intense Pink
            let color = 'rgba(255, 255, 255, 0.05)';
            if (count > 0) {
                if (ratio < 0.2) color = '#00f2fe';
                else if (ratio < 0.4) color = '#4facfe';
                else if (ratio < 0.6) color = '#96e6a1';
                else if (ratio < 0.8) color = '#f093fb';
                else color = '#f5576c';
            }

            cell.style.backgroundColor = color;
            if (count > 0) cell.style.boxShadow = `0 0 10px ${color}44`;
            
            cell.dataset.time = `${h.toString().padStart(2, '0')}:00`;
            cell.textContent = count; // Visible on hover
            heatmapContainer.appendChild(cell);
        });
    }

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

async function generateHandover() {
    const picName = document.getElementById('current-pic')?.textContent.replace('(Active)', '').trim() || 'PIC';
    
    // Show modal with loading state first
    const handoverText = document.getElementById('handover-text');
    if (handoverText) {
        handoverText.value = "🔄 Gemini is analyzing shift incidents and generating your report...";
    }
    openModal('handover-modal');

    try {
        const response = await apiFetch('/api/generate-handover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ picName })
        });
        const data = await response.json();

        if (data.success && handoverText) {
            handoverText.value = data.content.trim();
        } else {
            throw new Error(data.error || "Failed to generate AI handover");
        }
    } catch (e) {
        console.error("Handover AI Generic Error:", e);
        if (handoverText) {
            handoverText.value = "⚠️ AI Generation Failed. Please manually summarize the shift.\n\n" + 
                               "Outgoing PIC: " + picName + "\n" +
                               "Date: " + new Date().toLocaleDateString();
        }
    }
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
    if (tabId === 'admin') loadAdminData();
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

async function bulkRecategorize() {
    if (!confirm("This will re-analyze all historical messages using Gemini 3 Flash. This may take a moment. Continue?")) return;

    const btn = document.getElementById('bulk-recat-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="pulse-dot online"></span> Re-Processing Archive...';

    try {
        const response = await fetch('/api/admin/bulk-recategorize', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': HUB_PASSWORD 
            }
        });
        const data = await response.json();
        
        if (data.success) {
            alert(`🎉 Success!\n${data.message}`);
            // Refresh views
            initTimeline();
            loadRawLogs();
        } else {
            alert("Failed: " + data.error);
        }
    } catch (e) {
        console.error(e);
        alert("Request Failed: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
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


// --- Admin Configuration Logic ---

async function loadAdminData() {
    try {
        // Load Blacklist
        const wRes = await apiFetch('/api/config/blacklist');
        const blacklist = await wRes.json();
        const wList = document.getElementById('blacklist-list');
        if (wList) {
            wList.innerHTML = blacklist.map(item => `
                <div class="admin-item">
                    <div class="item-info">
                        <span class="item-id">ID: ${item.chat_id}</span>
                        <span>${item.title}</span>
                    </div>
                    <button class="remove-btn" onclick="removeFromBlacklist('${item.chat_id}')">REMOVE</button>
                </div>
            `).join('') || '<p style="text-align:center; opacity: 0.5; padding: 1rem;">No blacklisted chats (Monitoring all).</p>';
        }

        // Load Support Team
        const sRes = await apiFetch('/api/config/support-team');
        const supportMembers = await sRes.json();
        const sList = document.getElementById('support-team-list');
        if (sList) {
            sList.innerHTML = supportMembers.map(item => `
                <div class="admin-item">
                    <div class="item-info">
                        <span class="item-id">UID: ${item.user_id}</span>
                        <span>${item.name}</span>
                    </div>
                    <button class="remove-btn" onclick="removeFromSupportTeam('${item.user_id}')">REMOVE</button>
                </div>
            `).join('') || '<p style="text-align:center; opacity: 0.5; padding: 1rem;">No support members defined.</p>';
        }

        // Load Public Holidays
        const hRes = await apiFetch('/api/config/holidays');
        const holidays = await hRes.json();
        PUBLIC_HOLIDAYS = holidays;
        const hList = document.getElementById('holidays-list');
        if (hList) {
            hList.innerHTML = holidays.map(item => `
                <div class="admin-item">
                    <div class="item-info">
                        <span class="item-id">${item.holiday_date}</span>
                        <span>${item.name} ${item.is_office_closed ? '(Closed)' : ''}</span>
                    </div>
                    <button class="remove-btn" onclick="removeHoliday(${item.id})">REMOVE</button>
                </div>
            `).join('') || '<p style="text-align:center; opacity: 0.5; padding: 1rem;">No holidays defined.</p>';
        }

        // Load Roster Weeks
        const rRes = await apiFetch('/api/roster');
        const weeks = await rRes.json();
        const rList = document.getElementById('manage-weeks-list');
        if (rList) {
            rList.innerHTML = weeks.map((w, idx) => `
                <div class="admin-item">
                    <div class="item-info">
                        <span class="item-id">${w.dateRange}</span>
                        <span>${w.title}</span>
                    </div>
                    <button class="remove-btn" onclick="removeRosterWeek('${w.id || idx}')">REMOVE</button>
                </div>
            `).join('') || '<p style="text-align:center; opacity: 0.5; padding: 1rem;">No weeks generated.</p>';
        }

        // Init Roster Generator
        initRosterGen(weeks);
    } catch (e) {
        console.error("Failed to load admin data:", e);
    }
}

async function removeRosterWeek(id) {
    if (!confirm("Are you sure you want to delete this weekly roster? This action cannot be undone.")) return;
    try {
        await apiFetch(`/api/roster/week/${id}`, { method: 'DELETE' });
        loadAdminData(); // Refresh list
        initRoster(); // Refresh the main roster view
    } catch (e) {
        alert("Failed to delete week: " + e.message);
    }
}


function initRosterGen(existingWeeks = []) {
    const select = document.getElementById('gen-week-range');
    if (!select) return;

    const existingRanges = existingWeeks.map(w => w.dateRange);
    const options = [];
    let d = new Date();
    // Advance to next Monday
    d.setDate(d.getDate() + (1 - d.getDay() + 7) % 7);
    d.setHours(0, 0, 0, 0);

    for (let i = 0; i < 8; i++) {
        const start = new Date(d);
        const end = new Date(d);
        end.setDate(d.getDate() + 6);

        const startStr = start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        const endStr = end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        
        const jsonRange = `${start.getDate().toString().padStart(2, '0')}${start.toLocaleString('en-US', {month: 'short'})}-${end.getDate().toString().padStart(2, '0')}${end.toLocaleString('en-US', {month: 'short'})}`;
        
        // Only add if this week doesn't already exist
        if (!existingRanges.includes(jsonRange)) {
            const title = `Week ${i + 1} (${startStr} - ${endStr})`;
            options.push(`<option value="${jsonRange}|${title}">${title}</option>`);
        }
        d.setDate(d.getDate() + 7);
    }
    
    select.innerHTML = options.join('') || '<option value="" disabled selected>All available weeks generated</option>';
}

async function generateWeeklyRoster() {
    const rangeVal = document.getElementById('gen-week-range').value;
    if (!rangeVal) return;
    const parts = rangeVal.split('|');
    const dateRange = parts[0];
    const title = parts[1];
    
    const early = document.getElementById('gen-pic-early').value;
    const night = document.getElementById('gen-pic-night').value;
    const backup = document.getElementById('gen-pic-backup').value;

    if (!early || !night || !backup) return alert("Please select all PICs");

    const statusDiv = document.getElementById('gen-status');

    try {
        const res = await apiFetch('/api/roster/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dateRange, title, early, night, backup })
        });
        const data = await res.json();
        if (data.success) {
            statusDiv.style.display = 'block';
            statusDiv.textContent = "✅ Roster generated! Page will reload...";
            setTimeout(() => location.reload(), 1500);
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) { alert("Failed: " + e.message); }
}

async function addToBlacklist() {
    const chatId = document.getElementById('blacklist-chat-id').value.trim();
    const title = document.getElementById('blacklist-title').value.trim();
    if (!chatId || !title) return alert("Chat ID and Title are required");

    try {
        await apiFetch('/api/config/blacklist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, title: title })
        });
        document.getElementById('blacklist-chat-id').value = '';
        document.getElementById('blacklist-title').value = '';
        loadAdminData();
    } catch (e) { alert("Failed to add chat: " + e.message); }
}

async function removeFromBlacklist(id) {
    if (!confirm("Remove this chat from blacklist?")) return;
    try {
        await apiFetch(`/api/config/blacklist/${id}`, { method: 'DELETE' });
        loadAdminData();
    } catch (e) { alert("Failed to remove: " + e.message); }
}

async function addToSupportTeam() {
    const userId = document.getElementById('support-user-id').value.trim();
    const name = document.getElementById('support-name').value.trim();
    if (!userId || !name) return alert("User ID and Name are required");

    try {
        await apiFetch('/api/config/support-team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, name: name })
        });
        document.getElementById('support-user-id').value = '';
        document.getElementById('support-name').value = '';
        loadAdminData();
    } catch (e) { alert("Failed to add member: " + e.message); }
}

async function addHoliday() {
    const date = document.getElementById('holiday-date').value;
    const name = document.getElementById('holiday-name').value.trim();
    const closed = document.getElementById('holiday-closed').checked;
    if (!date || !name) return alert("Date and Name are required");

    try {
        await apiFetch('/api/config/holidays', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ holiday_date: date, name: name, is_office_closed: closed })
        });
        document.getElementById('holiday-date').value = '';
        document.getElementById('holiday-name').value = '';
        loadAdminData();
    } catch (e) { alert("Failed to add holiday: " + e.message); }
}

async function removeHoliday(id) {
    if (!confirm("Remove this holiday?")) return;
    try {
        await apiFetch(`/api/config/holidays/${id}`, { method: 'DELETE' });
        loadAdminData();
    } catch (e) { alert("Failed to remove: " + e.message); }
}

// --- Shift Swap Logic ---
let activeSwapData = null;

function openShiftSwap(day, rowIndex, shift, weekTitle) {
    // Only Ivan, DJ, Shawn are swappable for now
    const people = ['Ivan', 'DJ', 'Shawn'];
    const currentPIC = people.find(p => shift[p] && shift[p] !== 'Rest Day' && shift[p] !== 'AL');
    
    if (!currentPIC) return;

    activeSwapData = { day, rowIndex, currentPIC, weekTitle };
    
    // Find backup for this day to suggest
    const week = allWeeks.find(w => w.title === weekTitle);
    let backupPIC = '';
    if (week && week.days[day]) {
        const backupRow = week.days[day].find(s => s && s.time === 'On-call');
        if (backupRow) {
            backupPIC = Object.keys(backupRow).find(k => ['Ivan', 'DJ', 'Shawn'].includes(k) && backupRow[k] === 'Backup');
        }
    }

    const picSelect = document.getElementById('swap-pic');
    if (picSelect) {
        picSelect.value = backupPIC || '';
        document.getElementById('swap-hint').textContent = backupPIC ? `System suggests backup: ${backupPIC}` : 'Manual selection required.';
    }

    openModal('swap-modal');
}

async function confirmShiftSwap() {
    if (!activeSwapData) return;
    
    const reason = document.getElementById('swap-reason').value;
    const replacementPIC = document.getElementById('swap-pic').value;
    
    if (!replacementPIC) return alert("Please select a replacement PIC");

    const btn = document.getElementById('confirm-swap-btn');
    btn.disabled = true;
    btn.textContent = 'Updating...';

    try {
        const res = await apiFetch('/api/roster/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...activeSwapData,
                reason,
                replacementPIC
            })
        });
        
        const data = await res.json();
        if (data.success) {
            closeModal('swap-modal');
            await initRoster(); // Reload data
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) {
        alert("Failed to swap shift: " + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Update Roster';
        activeSwapData = null;
    }
}


async function removeFromSupportTeam(id) {
    if (!confirm("Remove this member from support team?")) return;
    try {
        await apiFetch(`/api/config/support-team/${id}`, { method: 'DELETE' });
        loadAdminData();
    } catch (e) { alert("Failed to remove: " + e.message); }
}

async function triggerTestReport() {
    const btn = document.querySelector('button[onclick="triggerTestReport()"]');
    const originalText = btn.textContent;
    btn.textContent = "⏳ Generating...";
    btn.disabled = true;

    try {
        const response = await apiFetch('/api/test-summary', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            alert("✅ Success! Test report has been sent to your private Telegram.");
        } else {
            alert("❌ Error: " + (data.error || "Check if ADMIN_TG_ID is set in .env"));
        }
    } catch (e) {
        alert("❌ Failed to trigger: " + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}
