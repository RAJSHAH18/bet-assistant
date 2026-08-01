document.addEventListener('DOMContentLoaded', () => {
  const masterToggle = document.getElementById('masterToggle');
  const statusText = document.getElementById('status-text');

  chrome.storage.local.get(['isActive'], (data) => {
    const isActive = data.isActive !== undefined ? data.isActive : true;
    masterToggle.checked = isActive;
    updateUI(isActive);
  });

  masterToggle.addEventListener('change', (e) => {
    const isActive = e.target.checked;
    if (!isActive) {
      chrome.storage.local.set({ isActive: isActive, autoPlace: false });
    } else {
      chrome.storage.local.set({ isActive: isActive });
    }
    updateUI(isActive);
  });

  function updateUI(isActive) {
    if (isActive) {
      statusText.innerText = "SYSTEM ACTIVE";
      statusText.className = "active";
    } else {
      statusText.innerText = "SYSTEM OFF";
      statusText.className = "";
    }
  }
});