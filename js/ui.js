// ui.js
// Small shared helpers for showing things on screen.

// Risk levels used across the whole app.
// Every level has a colour AND an icon AND a word, so the meaning never
// depends on colour alone (colour-blind users, glare in a factory).
export const RISK_LEVELS = {
  negligible: { label: 'Negligible', icon: 'check' },
  low: { label: 'Low', icon: 'check' },
  medium: { label: 'Medium', icon: 'alert' },
  high: { label: 'High', icon: 'triangle' },
  veryhigh: { label: 'Very high', icon: 'stop' },
};

const ICON_PATHS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" />',
  alert: '<circle cx="12" cy="12" r="9" /><path d="M12 7v6" /><path d="M12 16.5v.5" />',
  triangle: '<path d="M12 3.5L22 20H2z" /><path d="M12 10v4.5" /><path d="M12 17v.5" />',
  stop: '<path d="M8 2.5h8L21.5 8v8L16 21.5H8L2.5 16V8z" /><path d="M9 9l6 6M15 9l-6 6" />',
};

export function iconSvg(iconName) {
  const paths = ICON_PATHS[iconName] || ICON_PATHS.alert;
  return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
}

// A badge such as  [▲ High risk]  coloured by level.
export function riskBadge(levelKey, customText) {
  const level = RISK_LEVELS[levelKey] || RISK_LEVELS.medium;
  const text = customText || level.label;
  return '<span class="badge risk-' + levelKey + '">' + iconSvg(level.icon) +
    '<span>' + escapeHtml(text) + '</span></span>';
}

export function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDate(isoText) {
  try {
    const date = new Date(isoText);
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
      ', ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    return isoText;
  }
}

export function formatHours(hours) {
  if (!isFinite(hours)) {
    return 'No limit';
  }
  if (hours >= 24) {
    return 'More than 24 h';
  }
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  if (wholeHours === 0) {
    return minutes + ' min';
  }
  if (minutes === 0) {
    return wholeHours + ' h';
  }
  return wholeHours + ' h ' + minutes + ' min';
}

// Opens one fold-out step (the others in its group close automatically)
// and brings it into view.
export function openStep(stepId) {
  const step = document.getElementById(stepId);
  if (!step) {
    return;
  }
  step.open = true;
  setTimeout(function () {
    step.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

let toastTimer = null;
export function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) {
    return;
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.classList.remove('visible');
  }, 2800);
}

export function downloadTextFile(fileName, text, mimeType) {
  const blob = new Blob([text], { type: mimeType || 'text/plain' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
}

// Turns a list of rows (arrays) into CSV text.
export function toCsv(rows) {
  const lines = [];
  for (const row of rows) {
    const cells = [];
    for (const cell of row) {
      let text = cell === undefined || cell === null ? '' : String(cell);
      if (/[",\n]/.test(text)) {
        text = '"' + text.replace(/"/g, '""') + '"';
      }
      cells.push(text);
    }
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}
