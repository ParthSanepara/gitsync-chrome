const $ = (id) => document.getElementById(id);
const FIELDS = ['srcUrl', 'srcRef', 'tgtRepo', 'tgtBranch', 'blobSizes', 'upstream', 'upstreamBranch', 'fork', 'control', 'authForm'];

function log(line) {
  const el = $('log');
  el.textContent += `[${new Date().toISOString().slice(11, 23)}] ${line}\n`;
  el.scrollTop = el.scrollHeight;
}

// Non-secret form values persist locally for convenience. The PAT never does.
chrome.storage.local.get(FIELDS).then((saved) => {
  for (const f of FIELDS) if (saved[f] != null) $(f).value = saved[f];
});
for (const f of FIELDS) $(f).addEventListener('change', () => chrome.storage.local.set({ [f]: $(f).value }));

async function refreshPatState() {
  const { pat } = await chrome.storage.session.get('pat');
  $('patState').textContent = pat ? 'PAT set for this session' : 'no PAT';
}
refreshPatState();

$('savePat').onclick = async () => {
  await chrome.storage.session.set({ pat: $('pat').value.trim() });
  $('pat').value = '';
  refreshPatState();
};

$('clear').onclick = () => ($('log').textContent = '');
$('copy').onclick = () => navigator.clipboard.writeText($('log').textContent);

function params() {
  const out = {};
  for (const f of FIELDS) out[f] = $(f).value.trim();
  out.force = $('force').checked;
  return out;
}

for (const btn of document.querySelectorAll('button[data-exp]')) {
  btn.onclick = async () => {
    const exp = btn.dataset.exp;
    log(`▶ requesting ${exp}`);
    const res = await chrome.runtime.sendMessage({ to: 'sw', type: 'run', exp, params: params() });
    log(`  sw ack (sw booted ${res?.swBootedAt})`);
  };
}

let lastProgressLog = 0;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.to !== 'ui') return;
  if (msg.type === 'progress') {
    $('status').textContent = msg.text;
    if (Date.now() - lastProgressLog > 5000) {
      lastProgressLog = Date.now();
      log(`  … ${msg.text}`);
    }
  } else if (msg.type === 'log') {
    log(msg.text);
  } else if (msg.type === 'result') {
    log(`■ ${msg.exp} result:\n${JSON.stringify(msg.result, null, 2)}`);
  }
});

// Exp 6 aid: ping on demand, not on a timer. A timer would keep the worker
// alive and hide the termination behaviour we are testing.
let lastBoot = null;
$('pingSw').onclick = async () => {
  const r = await chrome.runtime.sendMessage({ to: 'sw', type: 'ping' });
  const restarted = lastBoot && r?.swBootedAt !== lastBoot;
  log(`sw booted at ${r?.swBootedAt}${restarted ? ' (RESTARTED since last ping)' : ''}`);
  lastBoot = r?.swBootedAt;
};
