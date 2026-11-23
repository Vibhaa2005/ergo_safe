// feedback.js
// The Feedback screen: System Usability Scale (Brooke, 1996) plus
// look-and-feel ratings, used for the aesthetic evaluation.

import * as storage from './storage.js';
import { escapeHtml, showToast } from './ui.js';

const SUS_ITEMS = [
  'I think that I would like to use this app frequently.',
  'I found the app unnecessarily complex.',
  'I thought the app was easy to use.',
  'I think that I would need the support of a technical person to be able to use this app.',
  'I found the various functions in this app were well integrated.',
  'I thought there was too much inconsistency in this app.',
  'I would imagine that most people would learn to use this app very quickly.',
  'I found the app very cumbersome to use.',
  'I felt very confident using the app.',
  'I needed to learn a lot of things before I could get going with this app.',
];

const AESTHETIC_ITEMS = [
  { key: 'visualAppeal', text: 'The app looks clean and professional.' },
  { key: 'clarity', text: 'The risk colours, icons and words were easy to understand at a glance.' },
  { key: 'trust', text: 'I trust the recommendations the app gave.' },
  { key: 'comfort', text: 'I would feel comfortable using this in a real workplace.' },
];

// SUS: odd items score (answer − 1), even items score (5 − answer);
// the total (0–40) is multiplied by 2.5 to give 0–100.
export function susScore(answers) {
  let total = 0;
  for (let index = 0; index < 10; index++) {
    const answer = Number(answers[index]);
    total += index % 2 === 0 ? answer - 1 : 5 - answer;
  }
  return total * 2.5;
}

function susGrade(score) {
  if (score >= 80.3) return 'Excellent (grade A)';
  if (score >= 68) return 'Good — above average (68)';
  if (score >= 51) return 'OK — below average';
  return 'Poor';
}

function likertRow(name, text, number) {
  let html = '<fieldset class="likert"><legend>' + (number ? number + '. ' : '') + escapeHtml(text) + '</legend><div class="likert-options">';
  for (let value = 1; value <= 5; value++) {
    html += '<label><input type="radio" name="' + name + '" value="' + value + '" required><span>' + value + '</span></label>';
  }
  html += '</div><div class="likert-ends"><span>Strongly disagree</span><span>Strongly agree</span></div></fieldset>';
  return html;
}

export function initFeedbackView() {
  let susHtml = '';
  for (let index = 0; index < SUS_ITEMS.length; index++) {
    susHtml += likertRow('sus-' + index, SUS_ITEMS[index], index + 1);
  }
  document.getElementById('sus-items').innerHTML = susHtml;

  let aestheticHtml = '';
  for (const item of AESTHETIC_ITEMS) {
    aestheticHtml += likertRow('aesthetic-' + item.key, item.text, null);
  }
  document.getElementById('aesthetic-items').innerHTML = aestheticHtml;

  const form = document.getElementById('feedback-form');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const susAnswers = [];
    for (let index = 0; index < SUS_ITEMS.length; index++) {
      susAnswers.push(Number(form.querySelector('input[name="sus-' + index + '"]:checked').value));
    }
    const aesthetic = {};
    for (const item of AESTHETIC_ITEMS) {
      aesthetic[item.key] = Number(form.querySelector('input[name="aesthetic-' + item.key + '"]:checked').value);
    }
    const response = {
      id: storage.makeId(),
      date: new Date().toISOString(),
      participantCode: document.getElementById('participant-code').value.trim(),
      role: document.getElementById('participant-role').value,
      susAnswers: susAnswers,
      aesthetic: aesthetic,
      comments: document.getElementById('feedback-comments').value.trim(),
    };
    storage.saveFeedbackResponse(response);
    form.reset();
    showToast('Thank you! SUS score: ' + susScore(susAnswers).toFixed(1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

export function refreshFeedbackView() {
  const responses = storage.getFeedbackResponses();
  const summary = document.getElementById('feedback-summary');
  if (responses.length === 0) {
    summary.innerHTML = '<p class="empty">No responses yet.</p>';
    return;
  }
  let susTotal = 0;
  const aestheticTotals = {};
  for (const item of AESTHETIC_ITEMS) aestheticTotals[item.key] = 0;
  for (const response of responses) {
    susTotal += susScore(response.susAnswers);
    for (const item of AESTHETIC_ITEMS) aestheticTotals[item.key] += response.aesthetic[item.key];
  }
  const meanSus = susTotal / responses.length;
  let html = '<div class="tile-row">' +
    '<div class="tile"><span class="tile-value">' + responses.length + '</span><span class="tile-label">Responses</span></div>' +
    '<div class="tile"><span class="tile-value">' + meanSus.toFixed(1) + '</span><span class="tile-label">Mean SUS — ' + susGrade(meanSus) + '</span></div>' +
    '</div><table class="data-table"><thead><tr><th>Look and feel</th><th>Mean (1–5)</th></tr></thead><tbody>';
  for (const item of AESTHETIC_ITEMS) {
    html += '<tr><td>' + escapeHtml(item.text) + '</td><td>' + (aestheticTotals[item.key] / responses.length).toFixed(2) + '</td></tr>';
  }
  html += '</tbody></table>';
  summary.innerHTML = html;
}
