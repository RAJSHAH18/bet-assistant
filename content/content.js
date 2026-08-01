(function () {
  let isExtensionActive = false;
  let userStake = '100';
  let isAutoPlaceEnabled = false;
  let recentStakes = [];
  let processedNodes = new WeakSet();
  let shadowRoot = null;

  // =====================================================================
  // 1. THE HYBRID WEBSITE PARAMETERS DICTIONARY
  // =====================================================================
  const SITE_CONFIGS = {
    "cbtfexchange.com": {
      name: "CBTF",
      findInput: (rootNode) => {
        const allSlips = rootNode.querySelectorAll('app-betslip');
        for (let slip of allSlips) {
          let parentRow = slip.closest('tr');
          if (parentRow && !parentRow.classList.contains('d-none')) {
            // Strictly targets the stake box, never the odds box
            return slip.querySelector('input[id^="betAmount"]:not([disabled])');
          }
        }
        return null;
      },
      findSubmitButton: (activeInput) => {
        const container = activeInput.closest('app-betslip');
        if (container) return container.querySelector('button.btn-send');
        return null;
      }
    }
  };

  function getCurrentSiteConfig() {
    const hostname = window.location.hostname;
    for (let url in SITE_CONFIGS) {
      if (hostname.includes(url)) return SITE_CONFIGS[url];
    }
    return null;
  }
  // =====================================================================

  // 1. Initialize State
  chrome.storage.local.get(['isActive', 'stake', 'autoPlace', 'recentStakes'], (data) => {
    isExtensionActive = data.isActive !== undefined ? data.isActive : true; 
    userStake = data.stake || '100';
    isAutoPlaceEnabled = data.autoPlace || false;
    recentStakes = data.recentStakes || ['10', '50', '100', '250', '500'];

    nukeLoadersPermanent();
    injectProfessionalWidget();
    updateVisibility();
  });

  // Storage Sync
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.isActive) {
      isExtensionActive = changes.isActive.newValue;
      updateVisibility();
    }
    if (changes.stake) userStake = changes.stake.newValue;
    if (changes.autoPlace) {
      isAutoPlaceEnabled = changes.autoPlace.newValue;
      updateVisibility();
    }
    if (changes.recentStakes) recentStakes = changes.recentStakes.newValue;

    updateWidgetUI();
  });

  // Keep Widget Alive against aggressive SPAs
  setInterval(() => {
    if (isExtensionActive && !document.getElementById('bet-pro-widget-root')) {
      injectProfessionalWidget();
      updateVisibility();
    }
  }, 1000);

  // --- PERMANENT LOADER NUKER ---
  function nukeLoadersPermanent() {
    if (!document.getElementById('ub-loader-nuke')) {
      let styleTag = document.createElement('style');
      styleTag.id = 'ub-loader-nuke';
      styleTag.innerHTML = `
        app-bet-loader, .bet-loader, [class*="loader" i], [class*="spinner" i] {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
          visibility: hidden !important;
          width: 0 !important;
          height: 0 !important;
          z-index: -999999 !important;
        }
      `;
      document.head.appendChild(styleTag);
    }
  }

  // --- CLEAN CLICK-DRIVEN ENGINE ---
  document.addEventListener('click', (e) => {
    if (!isExtensionActive) return;
    if (e.target.closest('#bet-pro-widget-root')) return;
    if (!e.isTrusted) return; 
    if (e.target.closest('app-betslip') || e.target.closest('.slip-back')) return;

    processedNodes = new WeakSet(); 
    setTimeout(() => scanAndInject(document), 50);
  }, true);

  // PRECISE STEALTH MODE: Hides quick-bet box when Auto-Submit is ON, keeps history visible
  function toggleGlobalStealth(enable) {
    let styleTag = document.getElementById('ub-stealth-mode');
    if (enable) {
      if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'ub-stealth-mode';
        styleTag.innerHTML = `
          app-betslip .place-bet {
            opacity: 0 !important;
            position: fixed !important;
            top: -10000px !important;
            left: -10000px !important;
            pointer-events: none !important;
          }
        `;
        document.head.appendChild(styleTag);
      }
    } else {
      if (styleTag) styleTag.remove();
    }
  }

  function updateVisibility() {
    const host = document.getElementById('bet-pro-widget-root');
    if (host) {
      host.style.setProperty('display', isExtensionActive ? 'block' : 'none', 'important');
      if (!isExtensionActive && shadowRoot) {
        shadowRoot.getElementById('mainPanel').classList.remove('open');
      }
    }
    toggleGlobalStealth(isAutoPlaceEnabled && isExtensionActive);
  }

  // 2. Build the Responsive Professional Widget
  function injectProfessionalWidget() {
    if (document.getElementById('bet-pro-widget-root')) return;

    const host = document.createElement('div');
    host.id = 'bet-pro-widget-root';
    document.documentElement.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    shadowRoot.innerHTML = `
      <style>
        :host { position: fixed !important; bottom: 25px !important; right: 25px !important; z-index: 2147483647 !important; font-family: 'Inter', -apple-system, sans-serif !important; display: block; }
        @media (max-width: 600px) { :host { bottom: 15px !important; right: 15px !important; } .panel { width: calc(100vw - 30px) !important; bottom: 70px !important; right: 0 !important; } }
        .fab { width: 54px; height: 54px; background: #0b1120; border: 2px solid #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.5); transition: transform 0.2s; }
        .fab:hover { transform: scale(1.05); }
        .fab svg { width: 28px; height: 28px; fill: #10b981; }
        .panel { display: none; position: absolute; bottom: 75px; right: 0; width: 320px; background: rgba(15, 23, 42, 0.98); backdrop-filter: blur(10px); border: 1px solid #1e293b; border-radius: 12px; padding: 18px; box-shadow: 0 10px 40px rgba(0,0,0,0.9); color: #f8fafc; box-sizing: border-box; }
        .panel.open { display: block; animation: slideUp 0.2s ease-out; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #1e293b; padding-bottom: 10px; }
        .title { font-size: 16px; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 0.5px; }
        .close-icon { width: 24px; height: 24px; background: rgba(255,255,255,0.05); border-radius: 50%; display: flex; justify-content: center; align-items: center; cursor: pointer; transition: 0.2s; }
        .close-icon:hover { background: rgba(239, 68, 68, 0.2); }
        .close-icon svg { width: 12px; height: 12px; fill: #ef4444; }
        .section-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; margin: 12px 0 8px 0; font-weight: bold; letter-spacing: 0.5px; }
        .input-box { width: 100%; padding: 12px 14px; background: #0b1120; border: 1px solid #334155; border-radius: 8px; color: #10b981; font-size: 18px; font-weight: bold; box-sizing: border-box; transition: 0.2s; }
        .input-box:focus { outline: none; border-color: #10b981; box-shadow: 0 0 10px rgba(16, 185, 129, 0.2); }
        .chips-container { display: flex; gap: 8px; flex-wrap: wrap; }
        .chip { position: relative; background: radial-gradient(circle, #1e293b 30%, #0f172a 100%); border: 2px solid #334155; color: #e2e8f0; padding: 8px 12px; font-size: 13px; font-weight: 800; border-radius: 20px; cursor: pointer; box-shadow: inset 0 0 0 2px #1e293b, 0 3px 6px rgba(0,0,0,0.4); text-align: center; min-width: 45px; transition: all 0.2s; }
        .chip::before { content: ''; position: absolute; top: 2px; left: 2px; right: 2px; bottom: 2px; border: 1px dashed rgba(255,255,255,0.15); border-radius: 18px; pointer-events: none; }
        .chip:hover { transform: translateY(-2px); box-shadow: inset 0 0 0 2px #334155, 0 5px 10px rgba(0,0,0,0.6); }
        .chip.active { background: radial-gradient(circle, #10b981 30%, #059669 100%); border-color: #047857; color: #0b1120; box-shadow: inset 0 0 0 2px #10b981, inset 0 0 5px rgba(0,0,0,0.3), 0 0 12px rgba(16,185,129,0.5); }
        .switch-container { display: flex; justify-content: space-between; align-items: center; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 12px; border-radius: 8px; margin-top: 20px; }
        .switch-text { font-size: 13px; font-weight: bold; color: #ef4444; }
        .switch-text.active { color: #10b981; }
        .switch-container.active { background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.3); }
        .switch { position: relative; display: inline-block; width: 44px; height: 24px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #475569; transition: .3s; border-radius: 24px; }
        .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; }
        input:checked + .slider { background-color: #10b981; }
        input:checked + .slider:before { transform: translateX(20px); }
      </style>
      <div class="fab" id="fabBtn"><svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg></div>
      <div class="panel" id="mainPanel">
        <div class="row">
          <span class="title">Bet Engine</span>
          <div class="close-icon" id="closePanelBtn">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </div>
        </div>
        <div class="section-label">Active Stake Amount</div>
        <input type="number" id="stakeField" class="input-box" placeholder="Custom Stake...">
        <div class="section-label">Quick Presets</div>
        <div class="chips-container" id="presetChips">
          <div class="chip" data-val="10">10</div>
          <div class="chip" data-val="50">50</div>
          <div class="chip" data-val="100">100</div>
          <div class="chip" data-val="500">500</div>
          <div class="chip" data-val="1000">1000</div>
        </div>
        <div class="section-label">Recent User Inputs</div>
        <div class="chips-container" id="recentChips"></div>
        <div class="switch-container" id="autoPlaceBox">
          <span class="switch-text" id="autoPlaceLabel">Auto-Submit: OFF</span>
          <label class="switch">
            <input type="checkbox" id="autoPlaceToggle">
            <span class="slider"></span>
          </label>
        </div>
      </div>
    `;

    bindWidgetEvents();
    updateWidgetUI();
  }

  function bindWidgetEvents() {
    const panel = shadowRoot.getElementById('mainPanel');
    shadowRoot.getElementById('fabBtn').addEventListener('click', () => panel.classList.toggle('open'));
    shadowRoot.getElementById('closePanelBtn').addEventListener('click', () => panel.classList.remove('open'));
    shadowRoot.getElementById('autoPlaceToggle').addEventListener('change', (e) => {
      if (e.target.checked) {
        if (!confirm("STEALTH MODE: Auto-Submit will invisibly place bets instantly using your active stake.\n\nAre you sure you want to turn this ON?")) {
          e.target.checked = false;
          return;
        }
      }
      chrome.storage.local.set({ autoPlace: e.target.checked });
    });

    const stakeField = shadowRoot.getElementById('stakeField');
    stakeField.addEventListener('blur', (e) => processCustomInput(e.target.value));
    stakeField.addEventListener('keypress', (e) => { if (e.key === 'Enter') { processCustomInput(e.target.value); stakeField.blur(); } });

    shadowRoot.addEventListener('click', (e) => { if (e.target.classList.contains('chip')) saveNewStake(e.target.getAttribute('data-val')); });
  }

  document.addEventListener('mousedown', (e) => {
    const host = document.getElementById('bet-pro-widget-root');
    if (host && shadowRoot) {
      const panel = shadowRoot.getElementById('mainPanel');
      if (panel.classList.contains('open') && !e.composedPath().includes(host)) {
        panel.classList.remove('open');
      }
    }
  });

  function processCustomInput(val) {
    val = val.trim();
    if (val && !isNaN(val)) saveNewStake(val);
  }

  function saveNewStake(val) {
    userStake = val;
    let updatedRecent = [val, ...recentStakes.filter(s => s !== val)].slice(0, 5);
    chrome.storage.local.set({ stake: val, recentStakes: updatedRecent });
  }

  function updateWidgetUI() {
    if (!shadowRoot) return;
    shadowRoot.getElementById('autoPlaceToggle').checked = isAutoPlaceEnabled;
    const autoBox = shadowRoot.getElementById('autoPlaceBox');
    const autoLabel = shadowRoot.getElementById('autoPlaceLabel');
    if (isAutoPlaceEnabled) {
      autoBox.classList.add('active'); autoLabel.classList.add('active'); autoLabel.innerText = "AUTO-SUBMIT: ON";
    } else {
      autoBox.classList.remove('active'); autoLabel.classList.remove('active'); autoLabel.innerText = "AUTO-SUBMIT: OFF";
    }

    shadowRoot.getElementById('stakeField').value = userStake;
    shadowRoot.querySelectorAll('#presetChips .chip').forEach(chip => {
      chip.classList.toggle('active', chip.getAttribute('data-val') === userStake);
    });
    shadowRoot.getElementById('recentChips').innerHTML = recentStakes.map(val => `<div class="chip ${val === userStake ? 'active' : ''}" data-val="${val}">${val}</div>`).join('');
  }

  // 4. HYBRID SCANNER ENGINE
  function scanAndInject(rootNode) {
    let config = getCurrentSiteConfig();
    
    if (config) {
      let targetInput = config.findInput(rootNode);
      if (targetInput && !processedNodes.has(targetInput)) {
        executeCBTFInjection(targetInput, userStake, config);
      }
    } else {
      let successfullyInjected = false;
      const targets = rootNode.querySelectorAll('input:not([type="hidden"]), div[contenteditable="true"]');
      
      for (let el of targets) {
        if (processedNodes.has(el)) continue;

        const footprint = `${el.placeholder} ${el.name} ${el.className} ${el.id}`.toLowerCase();
        if (footprint.includes('stake') || footprint.includes('amount') || footprint.includes('wager') || footprint.includes('risk') || footprint.includes('total')) {
          executeUniversalInjection(el, userStake);
          successfullyInjected = true;
          break;
        }
      }

      if (!successfullyInjected) {
        const allButtons = rootNode.querySelectorAll('button, div[role="button"], .preset-btn, [class*="chip"]');
        for (let btn of allButtons) {
          if (processedNodes.has(btn)) continue;
          
          const rawText = (btn.innerText || btn.textContent || '').trim();
          const numberOnly = rawText.replace(/[^0-9.]/g, ''); 
          
          if (numberOnly === String(userStake)) {
            processedNodes.add(btn);
            btn.click(); 
            if (isAutoPlaceEnabled) clickOmniPlaceBet(btn);
            break;
          }
        }
      }
    }

    const allNodes = rootNode.querySelectorAll('*');
    for (let node of allNodes) {
      if (node.shadowRoot && node.id !== 'bet-pro-widget-root') scanAndInject(node.shadowRoot);
    }
  }

  function executeCBTFInjection(element, amount, config) {
    processedNodes.add(element);
    element.focus();

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    if (nativeSetter) nativeSetter.call(element, amount);
    else element.value = amount;

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();

    if (isAutoPlaceEnabled) {
      let submitBtn = config.findSubmitButton(element);
      if (submitBtn) {
        submitBtn.removeAttribute('disabled');
        submitBtn.disabled = false;
        
        const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
        const mouseup = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
        const click = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        
        submitBtn.dispatchEvent(mousedown);
        submitBtn.dispatchEvent(mouseup);
        submitBtn.dispatchEvent(click);
        
        submitBtn.disabled = true;
        submitBtn.style.pointerEvents = 'none';
      }
    }
  }

  function executeUniversalInjection(element, amount) {
    processedNodes.add(element);
    element.focus();

    if (element.isContentEditable) {
      element.innerText = amount;
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      if (nativeSetter) nativeSetter.call(element, amount);
      else element.value = amount;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();

    if (isAutoPlaceEnabled) clickOmniPlaceBet(element);
  }

  function clickOmniPlaceBet(referenceElement) {
    let container = referenceElement;
    for (let i = 0; i < 6; i++) {
      if (container.parentElement && container.parentElement !== document.body) container = container.parentElement;
    }

    const buttons = container.querySelectorAll('button, input[type="submit"], a[role="button"], div[role="button"]');
    for (let btn of buttons) {
      const text = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').toLowerCase();
      const signature = `${text} ${btn.className} ${btn.id}`.toLowerCase();

      if (signature.includes('cash') || signature.includes('cancel') || signature.includes('clear') || signature.includes('delete') || signature.includes('remove') || signature.includes('close')) continue; 

      if (signature.includes('place') || signature.includes('bet') || signature.includes('submit') || 
          signature.includes('confirm') || signature.includes('accept') || signature.includes('execute') || 
          signature.includes('book') || signature.includes('wager') || signature.includes('lay') || 
          signature.includes('back') || signature.includes('ok')) {
        
        btn.removeAttribute('disabled');
        btn.disabled = false;
        
        const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
        const mouseup = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
        const click = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        
        btn.dispatchEvent(mousedown);
        btn.dispatchEvent(mouseup);
        btn.dispatchEvent(click);
        
        btn.disabled = true;
        btn.style.pointerEvents = 'none';
        break;
      }
    }
  }
})();