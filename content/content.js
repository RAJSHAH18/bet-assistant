(function () {
  'use strict';

  let isExtensionActive = false;
  let userStake = '100';
  let isAutoPlaceEnabled = false;
  let recentStakes = [];
  let processedNodes = new WeakSet();
  let shadowRoot = null;
  let isPolling = false; // LOCK: prevents overlapping poll chains from multiple rapid clicks

  // =====================================================================
  // 1. SITE-SPECIFIC CONFIGURATION DICTIONARY (Strictly Isolated)
  // =====================================================================
  const SITE_CONFIGS = {
    "cbtfexchange.com": {
      name: "CBTF Exchange",
      findInput: (rootNode) => {
        const allSlips = rootNode.querySelectorAll('app-betslip');

        if (!window.cbtfLoggedSlipCount) {
          console.log(`[CBTF Debug] 🔍 Found ${allSlips.length} app-betslip element(s) in DOM.`);
          window.cbtfLoggedSlipCount = true;
        }

        if (allSlips.length === 0) {
          if (!window.cbtfLoggedNoSlips) {
            console.warn('[CBTF Debug] ❌ No <app-betslip> elements found at all. Was a bet clicked?');
            window.cbtfLoggedNoSlips = true;
          }
          return null;
        }

        for (let slip of allSlips) {
          let parentRow = slip.closest('tr');
          const isHidden = parentRow && parentRow.classList.contains('d-none');

          if (!window.cbtfLoggedRowState) {
            console.log(`[CBTF Debug] 🔍 Slip parent <tr> found: ${!!parentRow} | has d-none: ${isHidden}`);
            window.cbtfLoggedRowState = true;
          }

          if (parentRow && !isHidden) {
            // Try the primary selector first
            let input = slip.querySelector('input[id^="betAmount"]:not([disabled])');

            if (!input) {
              // Fallback: try without the id constraint in case CBTF changed their IDs
              input = slip.querySelector('input[type="number"]:not([disabled])');
              if (input && !window.cbtfLoggedFallback) {
                console.warn('[CBTF Debug] ⚠️ betAmount input not found by ID — using generic number input fallback:', input.id, input.className);
                window.cbtfLoggedFallback = true;
              }
            }

            if (input) {
              if (!window.cbtfLoggedFound) {
                console.log('[CBTF Debug] ✅ Found stake input:', input.id, input.className, 'value:', input.value);
                window.cbtfLoggedFound = true;
              }
              return input;
            } else {
              if (!window.cbtfLoggedNoInput) {
                console.warn('[CBTF Debug] ❌ app-betslip is visible but no enabled input found. Slip HTML:');
                console.warn(slip.innerHTML.substring(0, 800));
                window.cbtfLoggedNoInput = true;
              }
            }
          }
        }
        return null;
      },
      findSubmitButton: (activeInput) => {
        const container = activeInput.closest('app-betslip');
        if (!container) {
          console.warn('[CBTF Debug] ❌ findSubmitButton: Could not find parent <app-betslip> from input.');
          return null;
        }
        // Try primary class btn-send first
        let btn = container.querySelector('button.btn-send');
        if (!btn) {
          // Fallback: search all buttons for text-based match
          const allBtns = Array.from(container.querySelectorAll('button'));
          btn = allBtns.find(b => {
            const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
            return txt === 'place bet' || txt === 'place order' || txt === 'submit' || txt === 'place' || txt === 'send';
          });
          if (btn) {
            console.warn(`[CBTF Debug] ⚠️ btn-send not found — matched fallback button: "${btn.innerText.trim()}" class="${btn.className}"`);
          } else {
            console.warn('[CBTF Debug] ❌ findSubmitButton: No submit button found at all! Dumping all buttons:');
            const btnList = Array.from(container.querySelectorAll('button')).map(b => ({ cls: b.className, text: (b.innerText||'').trim() }));
            console.table(btnList);
          }
        } else {
          if (!window.cbtfLoggedBtn) {
            console.log('[CBTF Debug] ✅ Found submit button: btn-send | disabled:', btn.disabled);
            window.cbtfLoggedBtn = true;
          }
        }
        return btn || null;
      },
      applySiteSpecificStyles: (enableStealth) => {
        let styleId = 'cbtf-custom-isolated-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
        }
        styleTag.innerHTML = `
          app-bet-loader, .bet-loader, .loader, .spinner, .loading, .overlay, #loader, .placeloader, .placeloaderdesktop {
            display: none !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          ${enableStealth ? `
            app-betslip .place-bet {
              display: none !important;
              opacity: 0 !important;
              visibility: hidden !important;
              pointer-events: none !important;
            }
          ` : ''}
        `;
      }
    },

    // =====================================================================
    // tigerexch.ai — Exchange site (Angular-based, CBTF-like)
    // =====================================================================
    "tigerexch.ai": {
      name: "TigerExch",
      findInput: (rootNode) => {
        const allInputs = Array.from(rootNode.querySelectorAll(
          'input[id="bet-place-amount"], input[placeholder*="stack" i], input[type="number"], input[type="tel"], input[type="text"][inputmode="numeric"], input[type="text"][inputmode="decimal"], input[placeholder*="stake" i], input[placeholder*="amount" i], input[placeholder*="min" i]'
        )).filter(i => !i.disabled && !i.readOnly && !i.closest('.d-none') && i.offsetParent !== null);

        if (allInputs.length > 0) {
          let stakeInput = allInputs.find(i => i.id === 'bet-place-amount') ||
                           allInputs.find(i => i.classList.contains('bs_stakes_i')) ||
                           allInputs.find(i => (i.placeholder || '').toLowerCase().includes('stack')) ||
                           allInputs.find(i => (i.placeholder || '').toLowerCase().includes('stake')) ||
                           allInputs.find(i => (i.placeholder || '').toLowerCase().includes('amount'));

          if (!stakeInput) {
            const numberInputs = allInputs.filter(i => i.type === 'number' || i.type === 'tel');
            stakeInput = numberInputs.length > 0 ? numberInputs[numberInputs.length - 1] : allInputs[allInputs.length - 1];
          }

          if (!window.tigerLoggedFound) {
            console.log('[TigerExch Debug] ✅ Found stake input:', stakeInput.tagName, `id="${stakeInput.id}"`, `class="${stakeInput.className}"`, `placeholder="${stakeInput.placeholder}"`, '| value:', stakeInput.value);
            window.tigerLoggedFound = true;
          }
          return stakeInput;
        }
        return null;
      },
      findSubmitButton: (activeInput) => {
        let container = activeInput.parentElement;
        let depth = 0;
        while (container && container !== document.body && depth < 15) {
          let btn = container.querySelector('span.btn-green, span.btn-place-bet, span.place-bt-bet');
          if (btn && (btn.innerText||'').toLowerCase().includes('place bet')) return btn;
          
          btn = container.querySelector('button.btn-po');
          if (btn) return btn;

          btn = container.querySelector('button.btn-success:not(.btn-increment):not(.btn-decrement):not(.betButtonMinus):not(.betButtonPlus)');
          if (btn && (btn.innerText||'').toLowerCase().includes('place bet')) return btn;

          btn = container.querySelector('button.btn-send, button.placebet-btn');
          if (btn) return btn;

          const allBtns = container.querySelectorAll('button');
          for (const b of allBtns) {
            if ((b.innerText||'').toLowerCase().includes('place bet')) return b;
          }

          container = container.parentElement;
          depth++;
        }
        return document.querySelector('button.btn-po, button.btn-send, span.btn-place-bet');
      },
      applySiteSpecificStyles: (enableStealth) => {
        let styleId = 'tiger-custom-isolated-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
        }
        styleTag.innerHTML = `
          .loader, .spinner, .loading, .bet-loader, #loader, .overlay, .placeloader, .placeloaderdesktop {
            display: none !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          ${enableStealth ? `
            app-betslip, app-bet-slip, .place-bet-container, .bet-slip-box, .fancy-quick-tr, tr.bet-slip-row {
              opacity: 0 !important;
              visibility: hidden !important;
              pointer-events: none !important;
              position: fixed !important;
              top: -9999px !important;
              left: -9999px !important;
              z-index: -9999 !important;
            }
          ` : ''}
        `;
      }
    },

    // =====================================================================
    // thetiger247.com — Same exact structure as tigerexch247.me
    // =====================================================================
    "thetiger247.com": {
      name: "TheTiger247",
      findInput: (rootNode) => {
        let stakeInput = rootNode.querySelector('input#stake');
        let rateInput = rootNode.querySelector('input#rate');
        
        if (stakeInput && !stakeInput.disabled && !stakeInput.readOnly && stakeInput.offsetParent !== null) {
          let rateVal = rateInput ? rateInput.value : '';
          
          if (rateInput && (!rateVal || parseFloat(rateVal) <= 0)) {
            if (!stakeInput.dataset.firstSeen) stakeInput.dataset.firstSeen = Date.now().toString();
            if (Date.now() - parseInt(stakeInput.dataset.firstSeen) < 500) return null; 
          }
          return stakeInput;
        }
        return null;
      },
      findSubmitButton: (activeInput) => {
        let btn = document.getElementById('bet_place_btn');
        if (btn) return btn;
        
        let container = activeInput.closest('#bet_slip_modal, #bet-slip-content, .modal-content') || document.body;
        const allBtns = Array.from(container.querySelectorAll('a.btn-small, button, a.btn'));
        return allBtns.find(b => (b.innerText || b.textContent || '').trim().toLowerCase() === 'place bet') || null;
      },
      applySiteSpecificStyles: (enableStealth) => {
        let styleId = 'tiger247-custom-isolated-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
        }
        styleTag.innerHTML = `
          .preloader-wrapper, .loaders, .theme_loader_01, .preloader { display: none !important; opacity: 0 !important; pointer-events: none !important; }
          ${enableStealth ? `#bet_slip_modal, #bet-slip-content { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; position: fixed !important; top: -9999px !important; left: -9999px !important; z-index: -9999 !important; }` : ''}
        `;
      }
    },

    // =====================================================================
    // tigerexch247.me — Different DOM structure than tigerexch.ai
    // =====================================================================
    "tigerexch247.me": {
      name: "TigerExch247",
      findInput: (rootNode) => {
        // MUST explicitly target 'input#stake' because 'input#rate' is also a number input and appears first!
        let stakeInput = rootNode.querySelector('input#stake');
        let rateInput = rootNode.querySelector('input#rate');
        
        // Ensure the stake input is visible
        if (stakeInput && !stakeInput.disabled && !stakeInput.readOnly && stakeInput.offsetParent !== null) {
          
          let rateVal = rateInput ? rateInput.value : '';
          
          // If the rate input exists but is empty, the site is still loading the odds.
          if (rateInput && (!rateVal || parseFloat(rateVal) <= 0)) {
            if (!stakeInput.dataset.firstSeen) stakeInput.dataset.firstSeen = Date.now().toString();
            
            // Wait up to 500ms for the site to fill in the odds (AJAX + Modal Animation delay)
            if (Date.now() - parseInt(stakeInput.dataset.firstSeen) < 500) {
              return null; 
            } else {
              console.warn('[TigerExch247 Debug] ⚠️ Waited 500ms but rate is still empty. Proceeding anyway!');
            }
          }
          
          if (!window.tiger247LoggedFound) {
            console.log('[TigerExch247 Debug] ✅ Found stake input:', stakeInput.id, stakeInput.className, '| Rate:', rateVal);
            window.tiger247LoggedFound = true;
          }
          
          // Reset firstSeen for the next bet
          delete stakeInput.dataset.firstSeen;
          return stakeInput;
        }
        return null;
      },
      findSubmitButton: (activeInput) => {
        // Look for the specific ID first
        let btn = document.getElementById('bet_place_btn');
        if (btn) return btn;
        
        // Fallback to text matching
        let container = activeInput.closest('#bet_slip_modal, #bet-slip-content, .modal-content') || document.body;
        const allBtns = Array.from(container.querySelectorAll('a.btn-small, button, a.btn'));
        return allBtns.find(b => (b.innerText || b.textContent || '').trim().toLowerCase() === 'place bet') || null;
      },
      applySiteSpecificStyles: (enableStealth) => {
        let styleId = 'tiger247-custom-isolated-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
        }
        styleTag.innerHTML = `
          .preloader-wrapper, .loaders, .theme_loader_01, .preloader {
            display: none !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          ${enableStealth ? `
            #bet_slip_modal, #bet-slip-content {
              opacity: 0 !important;
              visibility: hidden !important;
              pointer-events: none !important;
              position: fixed !important;
              top: -9999px !important;
              left: -9999px !important;
              z-index: -9999 !important;
            }
          ` : ''}
        `;
      }
    },

    // =====================================================================
    // cbtfair9.com — Sidebar bet slip (place-bet-container structure)
    // HTML: .place-bet-container > .place-bet-box-body > .place-bet-stake > input[type=number]
    // Submit: .place-bet-action-buttons > button.btn-success
    // =====================================================================
    "cbtfair9.com": {
      name: "CBTF Air 9",
      findInput: (rootNode) => {
        // Primary: stake input is inside .place-bet-stake (never the odds input which is disabled text)
        const container = rootNode.querySelector('.place-bet-container');

        if (!window.cbtfair9LoggedContainer) {
          console.log(`[CBTFAir9 Debug] 🔍 .place-bet-container found: ${!!container}`);
          window.cbtfair9LoggedContainer = true;
        }

        if (!container) {
          if (!window.cbtfair9LoggedNoContainer) {
            console.warn('[CBTFAir9 Debug] ❌ .place-bet-container not found in DOM.');
            // Dump sidebar structure to help diagnose
            const sidebar = rootNode.querySelector('.right-sidebar, .sidebar');
            console.warn('[CBTFAir9 Debug] 🔍 Sidebar HTML:', sidebar ? sidebar.innerHTML.substring(0, 600) : 'No sidebar found');
            window.cbtfair9LoggedNoContainer = true;
          }
          return null;
        }

        // Stake input is specifically inside .place-bet-stake div
        let input = container.querySelector('.place-bet-stake input[type="number"]');

        // Fallback: any enabled number input inside the container
        if (!input) {
          input = container.querySelector('input[type="number"]:not([disabled])');
          if (input && !window.cbtfair9LoggedFallback) {
            console.warn('[CBTFAir9 Debug] ⚠️ .place-bet-stake input not found — using fallback input:', input.className);
            window.cbtfair9LoggedFallback = true;
          }
        }

        if (!input) {
          if (!window.cbtfair9LoggedNoInput) {
            console.warn('[CBTFAir9 Debug] ❌ No stake input found inside .place-bet-container. Container HTML:');
            console.warn(container.innerHTML.substring(0, 800));
            window.cbtfair9LoggedNoInput = true;
          }
          return null;
        }

        if (!window.cbtfair9LoggedFound) {
          console.log('[CBTFAir9 Debug] ✅ Found stake input:', input.className, '| current value:', input.value);
          window.cbtfair9LoggedFound = true;
        }
        return input;
      },
      findSubmitButton: (activeInput) => {
        const container = activeInput.closest('.place-bet-container');
        if (!container) {
          console.warn('[CBTFAir9 Debug] ❌ findSubmitButton: Could not trace back to .place-bet-container.');
          return null;
        }
        // Submit button is button.btn-success inside .place-bet-action-buttons
        let btn = container.querySelector('.place-bet-action-buttons button.btn-success');
        if (!btn) {
          // Fallback: any btn-success in the container
          btn = container.querySelector('button.btn-success');
        }
        if (!btn) {
          console.warn('[CBTFAir9 Debug] ❌ Submit button not found. Dumping action buttons:');
          const allBtns = Array.from(container.querySelectorAll('button')).map(b => ({ cls: b.className, text: (b.innerText||'').trim(), disabled: b.disabled }));
          console.table(allBtns);
          return null;
        }
        if (!window.cbtfair9LoggedBtn) {
          console.log('[CBTFAir9 Debug] ✅ Found submit button:', btn.className, '| disabled:', btn.disabled);
          window.cbtfair9LoggedBtn = true;
        }
        return btn;
      },
      applySiteSpecificStyles: (enableStealth) => {
        let styleId = 'cbtfair9-custom-isolated-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
        }
        styleTag.innerHTML = `
          ${enableStealth ? `
            .place-bet-container {
              opacity: 0 !important;
              visibility: hidden !important;
              pointer-events: none !important;
              position: fixed !important;
              top: -9999px !important;
              left: -9999px !important;
              z-index: -9999 !important;
            }
          ` : ''}
        `;
      }
    },

    // =====================================================================
    // r777.us — Exchange site (Angular-based, similar template to mango777)
    // The bet slip appears dynamically after clicking Back/Lay buttons.
    // Tries multiple common patterns: app-betslip, place-bet-container, then universal
    // =====================================================================
    "r777.us": {
      name: "R777",
      findInput: (rootNode) => {
        // R777 is a REACT site (main.xxxxx.js bundle) — not Angular.
        // The bet slip structure is unknown. We search aggressively across all patterns.

        // --- BROAD SEARCH: Find ANY input that could be a stake box ---
        const allInputs = Array.from(rootNode.querySelectorAll(
          'input[type="number"], input[type="tel"], input[type="text"][inputmode="numeric"], input[type="text"][inputmode="decimal"], input[placeholder*="stake" i], input[placeholder*="amount" i], input[placeholder*="min" i]'
        )).filter(i => !i.disabled && !i.readOnly);

        if (allInputs.length > 0) {
          // Prioritize by class/placeholder hints
          let stakeInput = allInputs.find(i => i.classList.contains('bs_stakes_i')) ||
                           allInputs.find(i => (i.placeholder || '').toLowerCase().includes('stake')) ||
                           allInputs.find(i => (i.placeholder || '').toLowerCase().includes('amount')) ||
                           allInputs.find(i => (i.placeholder || '').toLowerCase().includes('min'));

          // If no clear match, pick the LAST number/tel input (stake is usually after odds)
          if (!stakeInput) {
            const numberInputs = allInputs.filter(i => i.type === 'number' || i.type === 'tel');
            stakeInput = numberInputs.length > 0 ? numberInputs[numberInputs.length - 1] : allInputs[allInputs.length - 1];
          }

          if (!window.r777LoggedFound) {
            console.log('[R777 Debug] ✅ Found stake input:', stakeInput.tagName, `type="${stakeInput.type}"`, `class="${stakeInput.className}"`, `placeholder="${stakeInput.placeholder}"`, '| value:', stakeInput.value);
            // Dump the surrounding container for context
            let parent = stakeInput.parentElement;
            for (let i = 0; i < 5 && parent && parent !== document.body; i++) parent = parent.parentElement;
            if (parent) {
              console.log('[R777 Debug] 🔍 Container HTML (5 levels up):');
              console.log(parent.outerHTML.substring(0, 1500));
            }
            window.r777LoggedFound = true;
          }
          return stakeInput;
        }

        // --- NO INPUTS FOUND: Install a MutationObserver to catch late React renders ---
        if (!window.r777ObserverInstalled) {
          window.r777ObserverInstalled = true;
          console.warn('[R777 Debug] ❌ No inputs found. Installing MutationObserver to catch React renders...');

          const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
              for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                // Check if this newly added node contains an input
                const newInputs = node.querySelectorAll ? Array.from(node.querySelectorAll('input')) : [];
                const selfIsInput = node.tagName === 'INPUT';
                if (selfIsInput) newInputs.push(node);

                if (newInputs.length > 0) {
                  console.warn(`[R777 Debug] 🆕 MutationObserver: React rendered ${newInputs.length} new input(s)!`);
                  const inputInfo = newInputs.map(i => ({
                    tag: i.tagName,
                    type: i.type,
                    cls: (i.className || '').toString().substring(0, 80),
                    id: i.id,
                    placeholder: i.placeholder,
                    disabled: i.disabled,
                    parentCls: i.parentElement ? i.parentElement.className.toString().substring(0, 80) : '(none)'
                  }));
                  console.table(inputInfo);

                  // Dump the container that was added (the bet slip component)
                  const container = node.nodeType === 1 ? node : node.parentElement;
                  if (container) {
                    console.warn('[R777 Debug] 🔍 Newly rendered container HTML:');
                    console.warn(container.outerHTML.substring(0, 2000));
                  }

                  observer.disconnect();
                  window.r777ObserverInstalled = false;
                  return;
                }
              }
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          // Auto-disconnect after 5 seconds if nothing appears
          setTimeout(() => {
            observer.disconnect();
            window.r777ObserverInstalled = false;
          }, 5000);
        }

        // --- Also dump ALL inputs (including hidden, disabled, text) for debugging ---
        if (!window.r777LoggedNone) {
          const everyInput = Array.from(rootNode.querySelectorAll('input'));
          if (everyInput.length > 0) {
            console.warn(`[R777 Debug] 🔍 Found ${everyInput.length} total input(s) on page (including disabled/hidden):`);
            const inputList = everyInput.map(i => ({
              type: i.type,
              cls: (i.className || '').toString().substring(0, 60),
              id: i.id,
              placeholder: i.placeholder,
              value: i.value.substring(0, 30),
              disabled: i.disabled,
              hidden: i.hidden || i.offsetParent === null,
              parentCls: i.parentElement ? i.parentElement.className.toString().substring(0, 60) : '(none)'
            }));
            console.table(inputList);
          } else {
            console.warn('[R777 Debug] 🔍 ZERO inputs of any kind found on entire page. React may be rendering in a portal or shadow DOM.');
            // Check for shadow DOMs
            const allEls = rootNode.querySelectorAll('*');
            let shadowCount = 0;
            for (const el of allEls) {
              if (el.shadowRoot) shadowCount++;
            }
            if (shadowCount > 0) console.warn(`[R777 Debug] 🔍 Found ${shadowCount} shadow DOM(s) — bet slip might be inside one.`);
          }
          window.r777LoggedNone = true;
        }
        return null;
      },
      findSubmitButton: (activeInput) => {
        // Try multiple patterns to find the submit/place order button

        // Pattern 1: Angular btn-po (within parent tree)
        let container = activeInput.parentElement;
        let depth = 0;
        while (container && container !== document.body && depth < 15) {
          // React/Custom Span Buttons (R777 specific)
          let btn = container.querySelector('span.btn-green, span.btn-place-bet, span.place-bt-bet');
          if (btn && (btn.innerText||'').toLowerCase().includes('place bet')) {
            if (!window.r777LoggedBtn) {
              console.log('[R777 Debug] ✅ Found submit button via span.btn-green:', btn.className);
              window.r777LoggedBtn = true;
            }
            return btn;
          }

          // btn-po class
          btn = container.querySelector('button.btn-po');
          if (btn) {
            if (!window.r777LoggedBtn) {
              console.log('[R777 Debug] ✅ Found submit button via .btn-po:', btn.className, '| disabled:', btn.disabled);
              window.r777LoggedBtn = true;
            }
            return btn;
          }
          // btn-success class (cbtfair9-style) - Exclude + / - increment buttons
          btn = container.querySelector('.place-bet-action-buttons button.btn-success') || 
                container.querySelector('button.btn-success:not(.btn-plus-minus):not(.btn-number)');
          if (btn) {
            if (!window.r777LoggedBtn) {
              console.log('[R777 Debug] ✅ Found submit button via .btn-success (new logic):', btn.className, '| disabled:', btn.disabled);
              window.r777LoggedBtn = true;
            }
            return btn;
          }
          // btn-send class (CBTF-style)
          btn = container.querySelector('button.btn-send');
          if (btn) {
            if (!window.r777LoggedBtn) {
              console.log('[R777 Debug] ✅ Found submit button via .btn-send:', btn.className, '| disabled:', btn.disabled);
              window.r777LoggedBtn = true;
            }
            return btn;
          }
          // Text-based fallback (now checks spans too)
          const allBtns = Array.from(container.querySelectorAll('button, span'));
          btn = allBtns.find(b => {
            const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
            return txt === 'place order' || txt === 'place bet' || txt === 'submit' || txt === 'place' || txt === 'send';
          });
          if (btn) {
            if (!window.r777LoggedBtn) {
              console.log(`[R777 Debug] ✅ Found submit button via text match: "${btn.innerText.trim()}" class="${btn.className}"`);
              window.r777LoggedBtn = true;
            }
            return btn;
          }
          container = container.parentElement;
          depth++;
        }

        console.warn('[R777 Debug] ❌ Submit button not found locally. Dumping all buttons near input:');
        let dumpContainer = activeInput.parentElement;
        for (let i = 0; i < 6 && dumpContainer && dumpContainer !== document.body; i++) dumpContainer = dumpContainer.parentElement;
        if (dumpContainer) {
          const btnList = Array.from(dumpContainer.querySelectorAll('button')).map(b => ({ 
            cls: b.className.substring(0, 60), 
            text: (b.innerText||'').trim().substring(0, 50), 
            disabled: b.disabled 
          }));
          console.table(btnList);
        }

        // --- GLOBAL SEARCH FALLBACK ---
        console.warn('[R777 Debug] 🔍 Falling back to document-wide search for Submit button...');
        const allDocBtns = Array.from(document.querySelectorAll('button, span'));
        const globalBtn = allDocBtns.find(b => {
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return txt === 'place order' || txt === 'place bet' || txt === 'submit' || txt === 'place' || txt === 'send';
        });

        if (globalBtn) {
          if (!window.r777LoggedBtn) {
            console.log(`[R777 Debug] ✅ Found submit button via GLOBAL text match: "${globalBtn.innerText.trim()}" class="${globalBtn.className}"`);
            window.r777LoggedBtn = true;
          }
          return globalBtn;
        }

        if (!window.r777LoggedGlobalBtnDmp) {
          console.warn('[R777 Debug] ❌ Global search failed. Dumping ALL buttons on page:');
          const allBtnList = Array.from(document.querySelectorAll('button')).map(b => ({
            cls: (b.className || '').toString().substring(0, 40),
            text: (b.innerText || b.textContent || '').trim().substring(0, 30)
          })).filter(b => b.text !== ''); // Only show buttons with text to reduce noise
          console.table(allBtnList);
          window.r777LoggedGlobalBtnDmp = true;
        }

        return null;
      },
      applySiteSpecificStyles: (enableStealth) => {
        let styleId = 'r777-custom-isolated-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
        }
        styleTag.innerHTML = `
          .loader, .spinner, .loading, .bet-loader, #loader, .overlay, .placeloader, .placeloaderdesktop {
            display: none !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          ${enableStealth ? `
            app-betslip, app-bet-slip,
            .place-bet-container,
            .bet-slip-box,
            .betslip-content,
            tr.bet-slip-row,
            tr#betFormBtns,
            tr#betFormBtnsMob,
            .b-t-slip,
            .b-t-slip-mobile,
            div:has(> app-betslip),
            div:has(> app-bet-slip) {
              opacity: 0 !important;
              visibility: hidden !important;
              pointer-events: none !important;
              position: fixed !important;
              top: -9999px !important;
              left: -9999px !important;
              z-index: -9999 !important;
              display: none !important;
            }
          ` : ''}
        `;
      }
    },
    "allpanel": {
      name: "All Panel",
      // Exact element parameter matchers (Targeting ID for ultra-fast lookup)
      findInput: (rootNode) => {
        return rootNode.querySelector('input[id^="placebetAmountWeb"]:not([disabled])');
      },
      findSubmitButton: (activeInput) => {
        // The submit button is within .place-bet-btn inside the same container
        const container = activeInput.closest('.bet-slip-container');
        if (container) {
          return container.querySelector('.place-bet-btn button.btn-primary');
        }
        return null;
      },
      // Dedicated site loader suppression & complete class hiding (No global leaks)
      applySiteSpecificStyles: (enableStealth) => {
        let styleId = 'allpanel-custom-isolated-style';
        let styleTag = document.getElementById(styleId);
        
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
        }

        styleTag.innerHTML = `
          .bodymovinanim {
            display: none !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          ${enableStealth ? `
            .bet-slip-container {
              display: none !important;
              opacity: 0 !important;
              visibility: hidden !important;
              pointer-events: none !important;
            }
          ` : ''}
        `;
      }
    },
    "allpanel247": {
      name: "All Panel 247",
      findInput: (rootNode) => {
        const containers = rootNode.querySelectorAll('.place-bet-container');
        if (containers.length === 0) {
           if (!window.loggedMissingContainer) {
              const sidebar = rootNode.querySelector('.sidebar.right-sidebar') || rootNode.querySelector('.sidebar');
              console.warn("[AllPanel247 Debug] ❌ FAILED: Could not find any element with class '.place-bet-container'!");
              console.warn("[AllPanel247 Debug] 👉 Right Sidebar HTML:", sidebar ? sidebar.innerHTML.substring(0, 800) : 'NO SIDEBAR FOUND');
              window.loggedMissingContainer = true;
           }
           return null;
        }
        
        const input = rootNode.querySelector('.place-bet-container input[type="number"]:not([disabled])');
        if (!input) {
           if (!window.loggedMissingInput) {
              console.warn("[AllPanel247 Debug] ❌ FAILED: Found '.place-bet-container', but could not find 'input[type=\"number\"]:not([disabled])' inside it!");
              console.warn("[AllPanel247 Debug] 👉 Container HTML:", containers[0].innerHTML);
              window.loggedMissingInput = true;
           }
           return null;
        }
        
        if (!window.loggedSuccess) {
           console.log("[AllPanel247 Debug] ✅ SUCCESS: Found input field!");
           window.loggedSuccess = true;
        }
        return input;
      },
      findSubmitButton: (activeInput) => {
        const container = activeInput.closest('.place-bet-container');
        if (container) {
          return container.querySelector('button.btn-success');
        }
        return null;
      },
      applySiteSpecificStyles: (enableStealth) => {
        let styleId = 'allpanel247-custom-isolated-style';
        let styleTag = document.getElementById(styleId);
        
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
        }

        styleTag.innerHTML = `
          ${enableStealth ? `
            .place-bet-container {
              display: none !important;
              opacity: 0 !important;
              visibility: hidden !important;
              pointer-events: none !important;
              z-index: -9999 !important;
            }
          ` : ''}
        `;
      }
    },
    "mango777.online": {
      name: "Mango777",
      findInput: (rootNode) => {
        const slip = rootNode.querySelector('app-bet-slip .bet-table, app-bet-slip');
        if (!slip) {
          if (!window.loggedMissingContainerMango) {
            console.warn('[Mango777 Debug] Bet slip container not found. Expected: app-bet-slip .bet-table');
            window.loggedMissingContainerMango = true;
          }
          return null;
        }

        const stakeInput = slip.querySelector('input.bs_stakes_i:not([disabled]), input[placeholder*="Min"]:not([disabled])');
        if (!stakeInput) {
          if (!window.loggedMissingInputMango) {
            console.warn('[Mango777 Debug] Stake input not found inside bet slip. Expected: input.bs_stakes_i');
            console.warn('[Mango777 Debug] Slip HTML:', slip.outerHTML.substring(0, 1200));
            window.loggedMissingInputMango = true;
          }
          return null;
        }

        if (!window.loggedSuccessMango) {
          console.log('[Mango777 Debug] Found exact stake input:', stakeInput.className, '| value:', stakeInput.value);
          window.loggedSuccessMango = true;
        }
        return stakeInput;
      },
      findSubmitButton: (activeInput) => {
        const slip = activeInput.closest('app-bet-slip, .bet-table, .card-body, .card') || document;
        let btn = slip.querySelector('button.btn-po');

        if (!btn) {
          const buttons = Array.from(slip.querySelectorAll('button'));
          btn = buttons.find((button) => {
            const text = (button.innerText || button.textContent || '').trim().toLowerCase();
            return text === 'place order' || text === 'place bet' || text === 'submit';
          });
        }

        if (!btn && !window.loggedFoundBtn) {
          console.warn('[Mango777 Debug] Submit button not found. Expected: button.btn-po');
          window.loggedFoundBtn = true;
        }
        return btn || null;
      },
      applySiteSpecificStyles: (enableStealth) => {
        let styleId = 'mango777-exact-stealth-style';
        let styleTag = document.getElementById(styleId);

        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
        }

        styleTag.innerHTML = `
          /* TARGET OVERLAYS: Using the exact HTML provided to kill the popup freezing */
          .overlay-container,
          #toast-container,
          .toast-container,
          .toast-top-center,
          .cdk-overlay-container,
          .cdk-global-overlay-wrapper,
          .ngx-toastr,
          .bodymovinanim, .loader, .spinner, .loading, .bet-loader, #loader, .overlay {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          ${enableStealth ? `
            app-bet-slip,
            app-bet-slip .bet-table,
            app-bet-slip .card,
            app-bet-slip .card-body,
            app-bet-slip .pb-co {
              opacity: 0 !important;
              visibility: hidden !important;
              pointer-events: none !important;
              position: fixed !important;
              top: -99999px !important;
              left: -99999px !important;
              width: 0px !important;
              height: 0px !important;
              max-width: 0px !important;
              max-height: 0px !important;
              overflow: hidden !important;
              z-index: -99999 !important;
              transform: scale(0) !important;
            }
          ` : ''}
        `;
      }
    },
    "laxmiexch247": {
      name: "Laxmi Exch 247",
      findInput: (rootNode) => {
        // The website may have changed its <button> tags to <div> or <span>. We search all common click targets.
        const allElements = Array.from(rootNode.querySelectorAll('button, div, span, a'));
        const submitBtn = allElements.find(el => {
           for (let child of el.childNodes) {
              if (child.nodeType === 3 && child.textContent.trim().toLowerCase() === 'submit') return true;
           }
           return false;
        });
        
        if (!submitBtn) {
           if (!window.loggedMissingContainerLaxmi) {
              console.warn(`[Laxmi Debug] ❌ FAILED: Could not find ANY element containing the exact text 'Submit' on the screen!`);
              window.loggedMissingContainerLaxmi = true;
           }
           return null;
        }

        // Traverse UP the DOM tree until we find the container holding the number inputs
        let container = submitBtn.parentElement;
        let inputs = [];
        while (container && container !== document.body) {
           inputs = Array.from(container.querySelectorAll('input[type="number"]'));
           if (inputs.length > 0) break; // Found the form container!
           container = container.parentElement;
        }

        let amountInput = inputs.find(input => !input.hasAttribute('step'));
        
        // Fallback: if all inputs have step, or neither do, just grab the last one
        if (!amountInput && inputs.length > 0) {
            amountInput = inputs[inputs.length - 1];
        }

        if (!amountInput) {
           if (!window.loggedMissingInputLaxmi) {
              console.warn("[Laxmi Debug] ❌ FAILED: Found Submit button, but no number inputs found in its parent tree!");
              window.loggedMissingInputLaxmi = true;
           }
           return null;
        }

        if (!window.loggedFormHtml) {
           window.loggedFormHtml = true;
           console.log("[Laxmi Debug] 🔍 Bet Slip Container Found! Exact HTML:");
           let cleanHtml = container.outerHTML.replace(/<svg[^>]*>.*?<\/svg>/g, '<svg>...</svg>');
           console.log(cleanHtml);
        }

        // -------------------------------------------------------------
        // INLINE STEALTH: Hide the box instantly without relying on CSS classes
        // -------------------------------------------------------------
        if (typeof isAutoPlaceEnabled !== 'undefined' && isAutoPlaceEnabled) {
            container.style.setProperty('opacity', '0', 'important');
            container.style.setProperty('visibility', 'hidden', 'important');
            container.style.setProperty('position', 'fixed', 'important');
            container.style.setProperty('z-index', '-9999', 'important');
            container.style.setProperty('pointer-events', 'none', 'important');
        }

        if (!window.loggedSuccessLaxmi) {
           console.log("[Laxmi Debug] ✅ SUCCESS: Found input field!");
           window.loggedSuccessLaxmi = true;
        }
        return amountInput;
      },
      findSubmitButton: (activeInput) => {
        let container = activeInput.parentElement;
        let allElements = [];
        let submitBtn = null;
        
        // Traverse UP the DOM tree until we find the Submit button
        while (container && container !== document.body) {
           allElements = Array.from(container.querySelectorAll('button, div, span, a'));
           submitBtn = allElements.find(el => {
              for (let child of el.childNodes) {
                 if (child.nodeType === 3 && child.textContent.trim().toLowerCase() === 'submit') return true;
              }
              return false;
           });
           if (submitBtn) return submitBtn;
           container = container.parentElement;
        }
        return null;
      },
      applySiteSpecificStyles: (enableStealth) => {
        let styleId = 'laxmiexch247-global-stealth';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
        }
        
        styleTag.innerHTML = `
          ${enableStealth ? `
            /* Hide Bet Slip Container BEFORE paint to prevent flash */
            /* CRITICAL: Do NOT use display: none here, it breaks React's input detection! */
            div[class*="fixed" i]:has(input[type="number"]):has(button.bg-\\[\\#198754\\]),
            div[class*="absolute" i]:has(input[type="number"]):has(button.bg-\\[\\#198754\\]),
            div[style*="rgba(255, 255, 255, 0)"]:has(input[type="number"]),
            div[tabindex="-1"]:has(input[type="number"]),
            div.max-w-lg,
            div.slide-down,
            .slide-down.max-w-lg {
              opacity: 0 !important;
              visibility: hidden !important;
              pointer-events: none !important;
              position: fixed !important;
              top: -9999px !important;
              left: -9999px !important;
              z-index: -9999 !important;
            }
            
            /* Hide the custom loader GIF and its centering div */
            div:has(> img[alt="loader"]),
            div:has(> img[src*="loader.gif" i]),
            img[alt="loader"],
            img[src*="loader.gif" i],
            
            /* Hide the transparent backdrop to prevent screen freeze */
            .MuiBackdrop-root,
            [class*="backdrop" i],
            [class*="overlay" i] {
              display: none !important;
              opacity: 0 !important;
              visibility: hidden !important;
              pointer-events: none !important;
              z-index: -9999 !important;
            }
          ` : ''}
        `;
      }
    }
  };

  // SITE_CONFIGS.mango777 = SITE_CONFIGS["mango777.online"];

  function getCurrentSiteConfig() {
    // If we received a cross-frame message from a parent, use the parent's hostname to lookup the config
    const hostname = window.injectedParentHostname || window.location.hostname;
    const sortedKeys = Object.keys(SITE_CONFIGS).sort((a, b) => b.length - a.length);
    for (let url of sortedKeys) {
      if (hostname.includes(url)) return SITE_CONFIGS[url];
    }
    return null;
  }

  // =====================================================================
  // 2. INITIALIZATION & LIFECYCLE
  // =====================================================================
  chrome.storage.local.get(['isActive', 'stake', 'autoPlace', 'recentStakes'], (data) => {
    isExtensionActive = data.isActive !== undefined ? data.isActive : true; 
    userStake = data.stake || '100';
    isAutoPlaceEnabled = data.autoPlace || false;
    recentStakes = data.recentStakes || ['10', '50', '100', '250', '500'];

    evaluateEnvironment();
    injectProfessionalWidget();
    updateVisibility();
  });

  // =====================================================================
  // DIAGNOSTIC HOTKEY (Ctrl + Shift + Y)
  // =====================================================================
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'Y' || e.key === 'y')) {
      console.log("[Bet Assistant Diagnostic] 🔍 Starting deep DOM search for 'Submit'...");
      let found = false;
      const searchDOM = (root, path) => {
        const buttons = root.querySelectorAll ? root.querySelectorAll('button') : [];
        buttons.forEach(b => {
          if (b.textContent && b.textContent.trim().toLowerCase() === 'submit') {
            console.log(`[Bet Assistant Diagnostic] ✅ FOUND 'Submit' BUTTON AT PATH: ${path}`);
            console.log(b);
            found = true;
          }
        });
        const iframes = root.querySelectorAll ? root.querySelectorAll('iframe') : [];
        iframes.forEach((f, i) => {
          try {
            if (f.contentDocument) searchDOM(f.contentDocument, path + ` > iframe[${i}]`);
            else console.log(`[Bet Assistant Diagnostic] ⚠️ Cross-origin iframe blocked: ${f.src}`);
          } catch(err) {
            console.log(`[Bet Assistant Diagnostic] ⚠️ Cross-origin iframe blocked: ${f.src}`);
          }
        });
        const allNodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
        allNodes.forEach(node => {
          if (node.shadowRoot) searchDOM(node.shadowRoot, path + ` > shadowRoot`);
        });
      };
      searchDOM(document, "MainDocument");
      if (!found) console.log("[Bet Assistant Diagnostic] ❌ 'Submit' button not found anywhere in accessible DOM.");
    }
  });

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

  // Instant Hostname Execution Guard (Zero latency checking)
  setInterval(() => {
    if (isExtensionActive) {
      if (!document.getElementById('bet-pro-widget-root')) {
        injectProfessionalWidget();
        updateVisibility();
      }
      evaluateEnvironment();
    }
  }, 500);

  function evaluateEnvironment() {
    const config = getCurrentSiteConfig();
    if (config && typeof config.applySiteSpecificStyles === 'function') {
      config.applySiteSpecificStyles(isAutoPlaceEnabled);
    } else {
      // Clean up isolated style if switching away from configured site
      let styleTag = document.getElementById('cbtf-custom-isolated-style');
      if (styleTag) styleTag.remove();
      let styleTagAllPanel = document.getElementById('allpanel-custom-isolated-style');
      if (styleTagAllPanel) styleTagAllPanel.remove();
      let styleTagAllPanel247 = document.getElementById('allpanel247-custom-isolated-style');
      if (styleTagAllPanel247) styleTagAllPanel247.remove();
    }
  }

  // =====================================================================
  // 3. EVENT LISTENERS & EXECUTION PIPELINE
  // =====================================================================
  document.addEventListener('click', (e) => {
    if (!isExtensionActive) return;
    if (e.target.closest('#bet-pro-widget-root')) return;
    if (!e.isTrusted) return;

    // LOCK: If a poll chain is already running, cancel it and start fresh
    if (isPolling) {
      console.log(`[Bet Assistant] ⚡ New click while polling — restarting fresh.`);
      try { console.timeEnd('BetAssistant-TotalExecution'); } catch(ex) {}
    }
    isPolling = true;
    processedNodes = new WeakSet();

    // Reset ALL debug flags on every click (all sites)
    window.loggedMissingContainer = false;
    window.loggedMissingInput = false;
    window.loggedSuccess = false;
    window.loggedHostname = false;
    // CBTF Exchange
    window.cbtfLoggedSlipCount = false;
    window.cbtfLoggedNoSlips = false;
    window.cbtfLoggedRowState = false;
    window.cbtfLoggedFallback = false;
    window.cbtfLoggedFound = false;
    window.cbtfLoggedNoInput = false;
    window.cbtfLoggedBtn = false;
    // CBTFAir9
    window.cbtfair9LoggedContainer = false;
    window.cbtfair9LoggedNoContainer = false;
    window.cbtfair9LoggedFallback = false;
    window.cbtfair9LoggedNoInput = false;
    window.cbtfair9LoggedFound = false;
    window.cbtfair9LoggedBtn = false;
    // R777
    window.r777LoggedFound = false;
    window.r777LoggedNone = false;
    window.r777LoggedBtn = false;
    window.r777ObserverInstalled = false;
    window.r777LoggedGlobalBtnDmp = false;
    // Mango
    window.loggedMissingContainerMango = false;
    window.loggedMissingInputMango = false;
    window.loggedSuccessMango = false;
    window.loggedFormHtmlMango = false;
    window.loggedFoundBtn = false;
    // Laxmi
    window.loggedMissingContainerLaxmi = false;
    window.loggedMissingInputLaxmi = false;
    window.loggedSuccessLaxmi = false;

    console.log(`[Bet Assistant] Click detected on:`, e.target.tagName, '|', e.target.className.toString().substring(0, 60));
    console.time('BetAssistant-TotalExecution');

    // Broadcast Wake-up Call immediately
    const broadcastWakeUp = () => {
      try {
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(f => {
          if (f.contentWindow) {
            f.contentWindow.postMessage({ 
              action: "BET_ASSISTANT_CROSS_FRAME_CLICK", 
              parentHostname: window.location.hostname 
            }, "*");
          }
        });
      } catch (err) {}
    };
    broadcastWakeUp();

    // 1. Instant synchronous check (0ms delay)
    if (scanAndExecute(document)) {
      console.log(`[Bet Assistant] ⚡ Found instantly on first pass!`);
      console.timeEnd('BetAssistant-TotalExecution');
      isPolling = false;
      return;
    }

    // 2. Optimized Polling for dynamic rendering
    let pollCount = 0;
    const clickId = Date.now(); // Unique ID for this click's poll chain
    window._betAssistantClickId = clickId;

    const pollForSlip = () => {
      // Bail out if a newer click has taken over
      if (window._betAssistantClickId !== clickId) {
        console.log(`[Bet Assistant] 🛑 Poll chain ${clickId} cancelled by newer click.`);
        return;
      }

      const t0 = performance.now();
      const found = scanAndExecute(document);
      const t1 = performance.now();
      if (t1 - t0 > 10) {
        console.warn(`[Bet Assistant Performance] Warning: scanAndExecute took ${Math.round(t1 - t0)}ms`);
      }

      if (found) {
        console.log(`[Bet Assistant] ✅ Found on poll #${pollCount}`);
        console.timeEnd('BetAssistant-TotalExecution');
        isPolling = false;
        return;
      }

      broadcastWakeUp();
      pollCount++;
      if (pollCount < 500) { // Poll every 10ms for up to 5 seconds
        setTimeout(pollForSlip, 10);
      } else {
        console.warn(`[Bet Assistant] ⏰ Timed out after 500 polls (5s). Bet slip not found on this click.`);
        console.timeEnd('BetAssistant-TotalExecution');
        isPolling = false;
      }
    };
    setTimeout(pollForSlip, 10);
  }, true);

  // =====================================================================
  // 3b. CROSS-FRAME RECEIVER
  // =====================================================================
  window.addEventListener('message', (e) => {
    if (e.data && e.data.action === "BET_ASSISTANT_CROSS_FRAME_CLICK") {
      if (!isExtensionActive) return;
      
      console.log(`[Bet Assistant Cross-Frame] 📡 Received wake-up signal from Parent (${e.data.parentHostname}) inside iframe. Local Hostname: "${window.location.hostname}"`);
      
      window.injectedParentHostname = e.data.parentHostname;
      processedNodes = new WeakSet();
      window.loggedMissingContainerLaxmi = false;
      window.loggedMissingInputLaxmi = false;
      window.loggedSuccessLaxmi = false;
      window.loggedHostname = false;

      // 1. Instant synchronous check
      scanAndExecute(document);

      // 2. Polling Check
      let pollCount = 0;
      const pollForSlip = () => {
        if (scanAndExecute(document)) return;
        pollCount++;
        if (pollCount < 100) {
          setTimeout(pollForSlip, 50);
        }
      };
      setTimeout(pollForSlip, 50);
    }
  });

  function updateVisibility() {
    const host = document.getElementById('bet-pro-widget-root');
    if (host) {
      host.style.setProperty('display', isExtensionActive ? 'block' : 'none', 'important');
      if (!isExtensionActive && shadowRoot) {
        shadowRoot.getElementById('mainPanel').classList.remove('open');
      }
    }
    evaluateEnvironment();
  }

  // =====================================================================
  // 4. SCANNER ENGINE (Strictly Partitioned)
  // =====================================================================
  function scanAndExecute(rootNode) {
    const config = getCurrentSiteConfig();

    if (!window.loggedHostname) {
       console.log(`[Bet Assistant Global Debug] Current execution Hostname is: "${window.location.hostname}"`);
       if (!config) console.log(`[Bet Assistant Global Debug] ❌ No config matched this hostname!`);
       window.loggedHostname = true;
    }

    let success = false;
    // PATH A: Dictionary / Site-Specific Architecture
    if (config) {
      let targetInput = config.findInput(rootNode);
      if (targetInput && !processedNodes.has(targetInput)) {
        console.log(`[Bet Assistant] Executing via SITE-SPECIFIC config for: ${config.name}`);
        const t0 = performance.now();
        executeConfiguredInjection(targetInput, userStake, config);
        console.log(`[Bet Assistant] Configured Injection Time: ${(performance.now() - t0).toFixed(2)}ms`);
        success = true;
      }
      
    } 
    // PATH B: Universal Fallback Architecture (For Unlisted Sites)
    else {
      let successfullyInjected = false;
      const targets = rootNode.querySelectorAll('input:not([type="hidden"]), div[contenteditable="true"]');
      
      for (let el of targets) {
        if (processedNodes.has(el)) continue;

        const footprint = `${el.placeholder} ${el.name} ${el.className} ${el.id}`.toLowerCase();
        if (['stake', 'amount', 'wager', 'risk', 'total'].some(kw => footprint.includes(kw))) {
          console.log('[Bet Assistant] Executing via UNIVERSAL fallback (Input detection)');
          const t0 = performance.now();
          executeUniversalInjection(el, userStake);
          console.log(`[Bet Assistant] Universal Injection Time: ${(performance.now() - t0).toFixed(2)}ms`);
          successfullyInjected = true;
          success = true;
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
            console.log('[Bet Assistant] Executing via UNIVERSAL fallback (Button preset detection)');
            const t0 = performance.now();
            processedNodes.add(btn);
            btn.click(); 
            if (isAutoPlaceEnabled) clickUniversalSubmitButton(btn);
            console.log(`[Bet Assistant] Universal Preset Button Time: ${(performance.now() - t0).toFixed(2)}ms`);
            success = true;
            break;
          }
        }
      }
    }

    if (success) return true;

    // Shadow DOM traversal check
    const allNodes = rootNode.querySelectorAll('*');
    for (let node of allNodes) {
      if (node.shadowRoot && node.id !== 'bet-pro-widget-root') {
        if (scanAndExecute(node.shadowRoot)) return true;
      }
    }

    // Iframe traversal check (Same-origin)
    if (rootNode.querySelectorAll) {
      const iframes = rootNode.querySelectorAll('iframe');
      for (let iframe of iframes) {
        try {
          if (iframe.contentDocument) {
            if (scanAndExecute(iframe.contentDocument)) return true;
          }
        } catch (e) {
          // Ignore cross-origin frame errors
        }
      }
    }
    
    return false;
  }
 function executeConfiguredInjection(element, amount, config) {
    // 1. INPUT LOCK: Prevents the scanner from injecting into the exact same input twice
    if (element.dataset.injected === '1') return;
    element.dataset.injected = '1';
    setTimeout(() => { delete element.dataset.injected; }, 300);

    processedNodes.add(element);
    element.focus();

    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (nativeSetter) {
        nativeSetter.call(element, amount);
      } else {
        element.value = amount;
      }
    } catch (e) {
      element.value = amount; 
    }

    // ==============================================================
    // ISOLATED LOGIC: ONLY FOR MANGO777 (Fixes Tokens & Consecutive Bets)
    // ==============================================================
    if (config && config.name === "Mango777") {
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true, composed: true })); 
      element.blur(); 

      if (isAutoPlaceEnabled) {
        // 25ms delay allows the Angular Virtual DOM to generate the security token
        setTimeout(() => {
          let submitBtn = config.findSubmitButton(element);
          if (submitBtn && !submitBtn.disabled && !submitBtn.hasAttribute('disabled')) {
            
            // STRICT DEBOUNCE: Prevents double-taps from causing "Invalid Token"
            if (submitBtn.getAttribute('data-bet-locked') === '1') return;
            submitBtn.setAttribute('data-bet-locked', '1');
            setTimeout(() => { submitBtn.removeAttribute('data-bet-locked'); }, 200); 

            submitBtn.style.removeProperty('pointer-events');

            // SINGLE CLICK EXECUTION
            const opts = { bubbles: true, cancelable: true, view: window };
            submitBtn.dispatchEvent(new MouseEvent('mousedown', opts));
            submitBtn.dispatchEvent(new MouseEvent('mouseup', opts));
            submitBtn.dispatchEvent(new MouseEvent('click', opts));

            // THE NETWORK SHIELD: Invisible 400ms lock across the whole screen.
            // This physically prevents tapping a different odd until the server 
            // has successfully reset and provided a fresh security token.
            let shield = document.createElement('div');
            shield.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:2147483647; background:transparent;';
            document.body.appendChild(shield);
            setTimeout(() => { if (shield.parentNode) shield.remove(); }, 400);

          }
        }, 25); 
      }
    } 
    // ==============================================================
    // ORIGINAL GLOBAL LOGIC: ALL OTHER SITES (UNTOUCHED)
    // ==============================================================
    else {
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));

      if (isAutoPlaceEnabled) {
        let attempts = 0;
        let observerCleaned = false;

        const doClick = (submitBtn) => {
          if (observerCleaned) return;
          observerCleaned = true;
          if (observer) observer.disconnect();
          triggerFastClick(submitBtn);
        };

        let observer = null;

        const trySubmit = () => {
          let submitBtn = config.findSubmitButton(element);

          if (!submitBtn) return;

          if (attempts === 0) {
            const isDisabled = submitBtn.disabled || submitBtn.hasAttribute('disabled');
            
            if (isDisabled) {
              observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                  if (m.attributeName === 'disabled' && !submitBtn.hasAttribute('disabled')) {
                    doClick(submitBtn);
                    return;
                  }
                }
              });
              observer.observe(submitBtn, { attributes: true, attributeFilter: ['disabled'] });
            } else {
              doClick(submitBtn);
              return;
            }
          }

          if (!submitBtn.disabled && !submitBtn.hasAttribute('disabled')) {
            doClick(submitBtn);
          } else if (attempts < 120) { 
            attempts++;
            requestAnimationFrame(trySubmit);
          } else {
            doClick(submitBtn);
          }
        };
        trySubmit();
      }
    }
  }
  function executeUniversalInjection(element, amount) {
    processedNodes.add(element);
    element.focus();

    if (element.isContentEditable) {
      element.innerText = amount;
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (nativeSetter) nativeSetter.call(element, amount);
      else element.value = amount;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();

    if (isAutoPlaceEnabled) clickUniversalSubmitButton(element);
  }

  function clickUniversalSubmitButton(referenceElement) {
    let container = referenceElement;
    for (let i = 0; i < 6; i++) {
      if (container.parentElement && container.parentElement !== document.body) {
        container = container.parentElement;
      }
    }

    const buttons = container.querySelectorAll('button, input[type="submit"], a[role="button"], div[role="button"]');
    for (let btn of buttons) {
      const text = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').toLowerCase();
      const signature = `${text} ${btn.className} ${btn.id}`.toLowerCase();

      if (['cash', 'cancel', 'clear', 'delete', 'remove', 'close'].some(kw => signature.includes(kw))) continue; 

      if (['place', 'bet', 'submit', 'confirm', 'accept', 'execute', 'book', 'wager', 'lay', 'back', 'ok'].some(kw => signature.includes(kw))) {
        triggerFastClick(btn);
        break;
      }
    }
  }

  function triggerFastClick(btn) {
    // Clear any leftover inline styles from our own previous injection
    // (Angular may reuse the same DOM button node across multiple bets)
    btn.removeAttribute('disabled');
    btn.disabled = false;
    btn.style.removeProperty('pointer-events');

    const opts = { bubbles: true, cancelable: true, view: window };
    if (window.PointerEvent) {
      btn.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'touch', isPrimary: true }));
      btn.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'touch', isPrimary: true }));
    }
    btn.dispatchEvent(new MouseEvent('mousedown', opts));
    btn.dispatchEvent(new MouseEvent('mouseup', opts));
    btn.dispatchEvent(new MouseEvent('click', opts));

    // Temporarily lock the button to prevent double-clicks.
    // Use a short timeout so Angular can reset state cleanly for the next bet.
    btn.setAttribute('data-bet-locked', '1');
    setTimeout(() => {
      btn.removeAttribute('data-bet-locked');
      btn.style.removeProperty('pointer-events');
      btn.disabled = false;
      console.log('[Bet Assistant Debug] 🔓 Button lock released for next bet.');
    }, 600);
  }

  // =====================================================================
  // 5. WIDGET UI BUILDER
  // =====================================================================
  function injectProfessionalWidget() {
    if (document.getElementById('bet-pro-widget-root')) return;

    // Prevent duplicate widgets: Only render the visual UI in the top-level main window
    try {
      if (window.top !== window.self) return;
    } catch (e) {
      // If window.top throws a security error (very rare for a simple equality check), we assume we're in an iframe
      return;
    }

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
        .chip:hover { transform: translateY(-2px); }
        .chip.active { background: radial-gradient(circle, #10b981 30%, #059669 100%); border-color: #047857; color: #0b1120; }
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
    const host = document.getElementById('bet-pro-widget-root');
    const panel = shadowRoot.getElementById('mainPanel');
    const fabBtn = shadowRoot.getElementById('fabBtn');

    // --- Drag and Drop Logic ---
    let isDragging = false;
    let hasDragged = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const dragStart = (e) => {
      if (panel.classList.contains('open')) return; // Don't drag if panel is open
      isDragging = true;
      hasDragged = false;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      startX = clientX;
      startY = clientY;
      const rect = host.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
    };

    const dragMove = (e) => {
      if (!isDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - startX;
      const dy = clientY - startY;

      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasDragged = true;
        if (e.cancelable) e.preventDefault(); // Stop scrolling on mobile when dragging
      }

      if (hasDragged) {
        host.style.setProperty('bottom', 'auto', 'important');
        host.style.setProperty('right', 'auto', 'important');
        host.style.setProperty('left', (initialLeft + dx) + 'px', 'important');
        host.style.setProperty('top', (initialTop + dy) + 'px', 'important');
      }
    };

    const dragEnd = () => {
      isDragging = false;
    };

    fabBtn.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', dragMove, { passive: false });
    document.addEventListener('mouseup', dragEnd);

    fabBtn.addEventListener('touchstart', dragStart, { passive: true });
    document.addEventListener('touchmove', dragMove, { passive: false });
    document.addEventListener('touchend', dragEnd);

    fabBtn.addEventListener('click', (e) => {
      if (hasDragged) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        panel.classList.toggle('open');
      }
    });

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

    shadowRoot.addEventListener('click', (e) => { 
      if (e.target.classList.contains('chip')) saveNewStake(e.target.getAttribute('data-val')); 
    });
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
      autoBox.classList.add('active'); 
      autoLabel.classList.add('active'); 
      autoLabel.innerText = "AUTO-SUBMIT: ON";
    } else {
      autoBox.classList.remove('active'); 
      autoLabel.classList.remove('active'); 
      autoLabel.innerText = "AUTO-SUBMIT: OFF";
    }

    shadowRoot.getElementById('stakeField').value = userStake;
    shadowRoot.querySelectorAll('#presetChips .chip').forEach(chip => {
      chip.classList.toggle('active', chip.getAttribute('data-val') === userStake);
    });
    shadowRoot.getElementById('recentChips').innerHTML = recentStakes.map(val => 
      `<div class="chip ${val === userStake ? 'active' : ''}" data-val="${val}">${val}</div>`
    ).join('');
  }
})();
