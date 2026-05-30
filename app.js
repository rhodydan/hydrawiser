/**
 * Hydrawise Zone Mapper - Core Application JavaScript
 */

// Global Diagnostic Error Handler
window.onerror = function(message, source, lineno, colno, error) {
  const panel = document.getElementById('global-error-panel');
  const msg = document.getElementById('global-error-message');
  if (panel && msg) {
    msg.textContent = `${message}\nat ${source}:${lineno}:${colno}\n\nStack:\n${error ? error.stack : 'N/A'}`;
    panel.style.display = 'block';
  }
  return false;
};

window.addEventListener('unhandledrejection', function(event) {
  const panel = document.getElementById('global-error-panel');
  const msg = document.getElementById('global-error-message');
  if (panel && msg) {
    msg.textContent = `Unhandled Promise Rejection: ${event.reason ? (event.reason.stack || event.reason || event) : 'Unknown reason'}`;
    panel.style.display = 'block';
  }
});

// Application State
const state = {
  apiKey: '',
  startLat: 47.674,
  startLng: -122.12,
  zones: [],
  activeZoneId: null,
  unit: 'sqft', // 'sqft' or 'sqm'
  isDrawing: false,
  address: '',
  mapGrayscale: 0,
  mapSaturation: 100,
  mapOpacity: 100,
  mapBlur: 0,
  selectedPolygon: null
};

// Global Maps references
let map;
let autocomplete;
let customDrawing = {
  zoneId: null,
  path: [],
  polyline: null,
  firstPointMarker: null,
  listeners: []
};

// Irrigation Sprinkler Presets
const SPRINKLER_PRESETS = [
  { color: '#0284c7', label: 'Rotor Blue', type: 'rotor' },
  { color: '#10b981', label: 'Spray Green', type: 'spray' },
  { color: '#f59e0b', label: 'Drip Orange', type: 'drip' },
  { color: '#d946ef', label: 'Micro-Spray Magenta', type: 'micro-drip' },
  { color: '#ef4444', label: 'Lateral Red', type: 'lateral' },
  { color: '#eab308', label: 'Mainline Yellow', type: 'mainline' }
];

// Document Load Event
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initApp();
  });
} else {
  initApp();
}

/**
 * Initialize application: check configurations and load components
 */
function initApp() {
  // Initialize slider values to defaults
  document.getElementById('map-filter-grayscale').value = 0;
  document.getElementById('map-filter-saturation').value = 100;
  document.getElementById('map-filter-opacity').value = 100;
  document.getElementById('map-filter-blur').value = 0;
  updateMapFilters();

  // Load configuration from localStorage
  const savedConfig = localStorage.getItem('hydrawise_map_config');
  
  if (savedConfig) {
    try {
      const config = JSON.parse(savedConfig);
      state.apiKey = config.apiKey || '';
      state.startLat = parseFloat(config.startLat) || 47.674;
      state.startLng = parseFloat(config.startLng) || -122.12;
      state.unit = config.unit || 'sqft';
      state.address = config.address || '';
      
      state.mapGrayscale = config.mapGrayscale !== undefined ? config.mapGrayscale : 0;
      state.mapSaturation = config.mapSaturation !== undefined ? config.mapSaturation : 100;
      state.mapOpacity = config.mapOpacity !== undefined ? config.mapOpacity : 100;
      state.mapBlur = config.mapBlur !== undefined ? config.mapBlur : 0;

      // Update slider inputs to match saved config
      document.getElementById('map-filter-grayscale').value = state.mapGrayscale;
      document.getElementById('map-filter-saturation').value = state.mapSaturation;
      document.getElementById('map-filter-opacity').value = state.mapOpacity;
      document.getElementById('map-filter-blur').value = state.mapBlur;
      updateMapFilters();
      
      // Update config inputs to match
      document.getElementById('config-api-key').value = state.apiKey;
      document.getElementById('config-address').value = state.address;
      
      // Load Google Maps API
      loadGoogleMaps(state.apiKey)
        .then(() => {
          setupApplication();
        })
        .catch(err => {
          console.error(err);
          alert('Failed to load Google Maps. Please check your API key and connection.');
          showSetupOverlay(true);
        });
    } catch (e) {
      console.error('Error parsing config, resetting', e);
      showSetupOverlay(true);
    }
  } else {
    showSetupOverlay(true);
  }

  // Bind Setup Event Listeners
  document.getElementById('btn-connect-key').addEventListener('click', handleConnectKey);
  document.getElementById('btn-setup-back').addEventListener('click', handleSetupBack);
  document.getElementById('btn-setup-finish').addEventListener('click', handleSetupFinish);

  document.getElementById('open-help-modal').addEventListener('click', (e) => {
    e.preventDefault();
    toggleModal('help-modal', true);
  });
  document.getElementById('close-help-modal').addEventListener('click', () => toggleModal('help-modal', false));
  document.getElementById('btn-close-help-confirm').addEventListener('click', () => toggleModal('help-modal', false));
  document.getElementById('help-backdrop').addEventListener('click', () => toggleModal('help-modal', false));

  // Sidebar controls
  setupSidebarTabs();
}

/**
 * Show or hide the full-screen setup overlay
 */
function showSetupOverlay(show) {
  const overlay = document.getElementById('setup-overlay');
  if (show) {
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

let setupAddressAutocomplete;

/**
 * Display setup connection error inline inside the setup card
 */
function showSetupError(msg) {
  const panel = document.getElementById('setup-error-panel');
  const text = document.getElementById('setup-error-text');
  if (panel && text) {
    text.textContent = msg;
    panel.classList.remove('hidden');
  }
}

/**
 * Hide inline setup connection error panel
 */
function hideSetupError() {
  const panel = document.getElementById('setup-error-panel');
  if (panel) {
    panel.classList.add('hidden');
  }
}

/**
 * Handle verification and Maps load for Step 1
 */
function handleConnectKey() {
  hideSetupError();
  const apiKey = document.getElementById('input-api-key').value.trim();
  if (!apiKey) {
    showSetupError('Please enter your Google Maps API Key.');
    return;
  }

  const btn = document.getElementById('btn-connect-key');
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting Key...';
  btn.setAttribute('disabled', 'true');

  loadGoogleMaps(apiKey)
    .then(() => {
      state.apiKey = apiKey;
      
      // Transition from Step 1 to Step 2
      document.getElementById('setup-step-1').classList.add('hidden');
      document.getElementById('setup-step-2').classList.remove('hidden');
      
      // Bind type-ahead geocoding to the Address input
      const setupAddressAutocompleteEl = document.getElementById('input-setup-address');
      if (setupAddressAutocompleteEl) {
        setupAddressAutocompleteEl.includedPrimaryTypes = ['geocode', 'establishment'];

        setupAddressAutocompleteEl.addEventListener('gmp-select', async (e) => {
          const finishBtn = document.getElementById('btn-setup-finish');
          try {
            const place = e.placePrediction.toPlace();
            await place.fetchFields({
              fields: ['location', 'formattedAddress']
            });
            
            if (place.location) {
              state.startLat = place.location.lat();
              state.startLng = place.location.lng();
              state.address = place.formattedAddress || '';
              finishBtn.removeAttribute('disabled');
            } else {
              finishBtn.setAttribute('disabled', 'true');
            }
          } catch (err) {
            console.error('Error fetching setup address:', err);
            finishBtn.setAttribute('disabled', 'true');
          }
        });
      }
    })
    .catch(err => {
      console.error(err);
      showSetupError(`Connection failed: ${err.message}`);
      btn.innerHTML = oldText;
      btn.removeAttribute('disabled');
    });
}

/**
 * Go back from address step to key entry
 */
function handleSetupBack() {
  document.getElementById('setup-step-2').classList.add('hidden');
  document.getElementById('setup-step-1').classList.remove('hidden');
  
  const btn = document.getElementById('btn-connect-key');
  btn.removeAttribute('disabled');
  btn.innerHTML = 'Connect API Key <i class="fa-solid fa-arrow-right"></i>';
}

/**
 * Complete setup, save config details and boot app
 */
function handleSetupFinish() {
  if (!state.apiKey || !state.address) {
    alert('Please select a starting property address from the dropdown.');
    return;
  }

  const config = {
    apiKey: state.apiKey,
    startLat: state.startLat,
    startLng: state.startLng,
    address: state.address,
    unit: state.unit
  };

  localStorage.setItem('hydrawise_map_config', JSON.stringify(config));
  
  // Reload page to start app with local config
  window.location.reload();
}

/**
 * Dynamically load Google Maps script
 */
function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve();
      return;
    }

    // Timeout loading logic to prevent infinite spinner if script fails silently or is blocked by extensions
    const timeoutId = setTimeout(() => {
      window.initMap = null; // clean up global callback
      reject(new Error('Google Maps script loading timed out. Check your adblocker, firewall, or API key configuration.'));
    }, 6000);

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry,places&callback=initMap&loading=async`;
    script.async = true;
    script.defer = true;
    
    script.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error('Maps script load failed.'));
    };

    window.initMap = () => {
      clearTimeout(timeoutId);
      resolve();
    };

    document.head.appendChild(script);
  });
}

/**
 * Setup Main Application once Google Maps is loaded
 */
function setupApplication() {
  showSetupOverlay(false);
  
  // Initialize Google Map
  const mapOptions = {
    center: { lat: state.startLat, lng: state.startLng },
    zoom: 20,
    mapTypeId: 'satellite',
    disableDefaultUI: true,
    zoomControl: false,
    scrollwheel: true,
    tilt: 0, // Force 2D view for accurate schematic overhead drawing
    renderingType: google.maps.RenderingType.RASTER // Force Raster tiles (images) instead of WebGL to support html2canvas
  };
  
  map = new google.maps.Map(document.getElementById('map'), {
    ...mapOptions,
    // Add custom styling to remove labels if needed for a clean schematic
    styles: [
      {
        featureType: 'all',
        elementType: 'labels',
        stylers: [{ visibility: 'on' }]
      }
    ]
  });

  // Deselect polygon and hide context menu when clicking empty map areas
  google.maps.event.addListener(map, 'click', () => {
    selectPolygon(null);
    hideContextMenu();
  });

  // Setup Address Autocomplete
  setupAutocomplete();

  // Setup Autocomplete on Sidebar config tab starting address
  const configAddressAutocompleteEl = document.getElementById('config-address');
  if (configAddressAutocompleteEl) {
    configAddressAutocompleteEl.placeholder = state.address || 'Type starting address...';
    configAddressAutocompleteEl.includedPrimaryTypes = ['geocode', 'establishment'];
    
    configAddressAutocompleteEl.addEventListener('gmp-select', async (e) => {
      try {
        const place = e.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['location', 'formattedAddress']
        });
        
        if (place.location) {
          state.startLat = place.location.lat();
          state.startLng = place.location.lng();
          state.address = place.formattedAddress || '';
          configAddressAutocompleteEl.placeholder = state.address;
        }
      } catch (err) {
        console.error('Error fetching config address details:', err);
      }
    });
  }

  // Initialize custom drawing listeners list
  customDrawing.listeners = [];

  // Bind Main UI Event Listeners
  bindAppEventListeners();

  // Load Saved Zones
  loadSavedZones();

  // Initial unit switch styling
  updateUnitButtons();
}

/**
 * Setup Address Autocomplete Search
 */
function setupAutocomplete() {
  const searchInput = document.getElementById('address-search-input');
  if (!searchInput) return;
  
  searchInput.removeAttribute('disabled');
  searchInput.includedPrimaryTypes = ['geocode', 'establishment'];

  // Bind Autocomplete to Map Viewport using locationBias
  if (map) {
    searchInput.locationBias = map.getBounds();
    google.maps.event.addListener(map, 'bounds_changed', () => {
      searchInput.locationBias = map.getBounds();
    });
  }

  searchInput.addEventListener('gmp-select', async (e) => {
    try {
      const place = e.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['location', 'formattedAddress']
      });

      if (!place.location) {
        alert("No geometry found for this location.");
        return;
      }

      // Pan & Zoom Map
      map.setCenter(place.location);
      map.setZoom(20);

      // Save address label
      state.address = place.formattedAddress || '';
      
      // Update legend UI & static export input
      document.getElementById('legend-overlay-subtitle').textContent = state.address;
      document.getElementById('export-subtitle-input').value = state.address;
      
      // Show clear button
      document.getElementById('btn-clear-search').classList.remove('hidden');

      // Update config coordinates so page refreshes center here
      updateConfigCoordinates(place.location.lat(), place.location.lng());
    } catch (err) {
      console.error('Error fetching search address:', err);
    }
  });

  // Clear Search button
  const clearBtn = document.getElementById('btn-clear-search');
  // Avoid duplicating clear button listeners if setupAutocomplete runs again
  const newClearBtn = clearBtn.cloneNode(true);
  clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
  
  newClearBtn.addEventListener('click', () => {
    // Re-create the search element to fully clear the custom element's closed Shadow DOM state
    const freshSearchInput = document.createElement('gmp-place-autocomplete');
    freshSearchInput.id = 'address-search-input';
    freshSearchInput.placeholder = 'Search property address...';
    
    const oldSearchInput = document.getElementById('address-search-input');
    if (oldSearchInput) {
      oldSearchInput.parentNode.replaceChild(freshSearchInput, oldSearchInput);
    }

    newClearBtn.classList.add('hidden');
    state.address = '';
    document.getElementById('legend-overlay-subtitle').textContent = 'Address Placeholder';

    // Re-initialize autocomplete and bindings on the fresh element
    setupAutocomplete();
  });
}

/**
 * Handle configuration coordinate and address updates on search
 */
function updateConfigCoordinates(lat, lng) {
  state.startLat = lat;
  state.startLng = lng;
  
  const configAddressAutocompleteEl = document.getElementById('config-address');
  if (configAddressAutocompleteEl) {
    configAddressAutocompleteEl.placeholder = state.address || 'Type starting address...';
  }
  
  const savedConfig = localStorage.getItem('hydrawise_map_config');
  if (savedConfig) {
    const config = JSON.parse(savedConfig);
    config.startLat = lat;
    config.startLng = lng;
    config.address = state.address;
    localStorage.setItem('hydrawise_map_config', JSON.stringify(config));
  }
}

/**
 * Bind DOM Event Listeners for the application controls
 */
function bindAppEventListeners() {
  // Add Zone Button
  document.getElementById('btn-add-zone').addEventListener('click', () => {
    const zoneNum = state.zones.length + 1;
    const defaultColor = SPRINKLER_PRESETS[(zoneNum - 1) % SPRINKLER_PRESETS.length].color;
    addNewZone(`Zone ${zoneNum}`, defaultColor);
  });

  // Cancel Drawing button
  document.getElementById('btn-cancel-drawing').addEventListener('click', cancelDrawingMode);

  // Finish Drawing button
  const finishDrawingBtn = document.getElementById('btn-finish-drawing');
  if (finishDrawingBtn) {
    finishDrawingBtn.addEventListener('click', finishCustomDrawing);
  }

  // Floating Draw Button Click (for mobile users)
  const floatingDrawBtn = document.getElementById('btn-floating-draw');
  if (floatingDrawBtn) {
    floatingDrawBtn.addEventListener('click', () => {
      if (state.activeZoneId) {
        startDrawingMode(state.activeZoneId);
      }
    });
  }

  // Sidebar Mobile Toggle
  const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar');
  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
      toggleSidebar();
    });
  }

  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
      toggleSidebar(false);
    });
  }

  // Export controls
  document.getElementById('btn-export-trigger').addEventListener('click', openExportModal);
  document.getElementById('close-export-modal').addEventListener('click', () => toggleModal('export-modal', false));
  document.getElementById('btn-cancel-export').addEventListener('click', () => toggleModal('export-modal', false));
  document.getElementById('export-backdrop').addEventListener('click', () => toggleModal('export-modal', false));
  document.getElementById('btn-download-schematic').addEventListener('click', executeDownload);

  // Unit Toggles
  document.getElementById('btn-unit-sqft').addEventListener('click', () => {
    state.unit = 'sqft';
    updateUnitButtons();
    renderZones();
    saveZonesData();
  });
  document.getElementById('btn-unit-sqm').addEventListener('click', () => {
    state.unit = 'sqm';
    updateUnitButtons();
    renderZones();
    saveZonesData();
  });

  // Setup Config panel listeners
  document.getElementById('btn-toggle-key-visibility').addEventListener('click', () => {
    const input = document.getElementById('config-api-key');
    const icon = document.querySelector('#btn-toggle-key-visibility i');
    if (input.type === 'password') {
      input.type = 'text';
      icon.className = 'fa-solid fa-eye-slash';
    } else {
      input.type = 'password';
      icon.className = 'fa-solid fa-eye';
    }
  });

  document.getElementById('btn-update-config').addEventListener('click', () => {
    const apiKey = document.getElementById('config-api-key').value.trim();
    const address = document.getElementById('config-address').value.trim();

    if (!apiKey) {
      alert('Please enter a valid Google Maps API Key.');
      return;
    }

    if (!address) {
      alert('Please enter a valid starting address.');
      return;
    }

    const config = { 
      apiKey, 
      startLat: state.startLat, 
      startLng: state.startLng, 
      address: state.address || address, 
      unit: state.unit,
      mapGrayscale: state.mapGrayscale,
      mapSaturation: state.mapSaturation,
      mapOpacity: state.mapOpacity,
      mapBlur: state.mapBlur
    };
    localStorage.setItem('hydrawise_map_config', JSON.stringify(config));
    window.location.reload();
  });

  document.getElementById('btn-open-help-config').addEventListener('click', () => {
    toggleModal('help-modal', true);
  });

  document.getElementById('btn-clear-all').addEventListener('click', () => {
    if (confirm('Are you sure you want to delete ALL zones and drawings? This cannot be undone.')) {
      state.zones.forEach(z => {
        z.polygons.forEach(p => p.setMap(null));
      });
      state.zones = [];
      state.activeZoneId = null;
      renderZones();
      saveZonesData();
    }
  });

  // Map Image Filter adjustments listeners
  const filterGrayscaleInput = document.getElementById('map-filter-grayscale');
  const filterSaturationInput = document.getElementById('map-filter-saturation');
  const filterOpacityInput = document.getElementById('map-filter-opacity');
  const filterBlurInput = document.getElementById('map-filter-blur');
  const btnResetFilters = document.getElementById('btn-reset-map-filters');

  const onFilterChange = () => {
    updateMapFilters();
    const exportModal = document.getElementById('export-modal');
    if (exportModal && !exportModal.classList.contains('hidden')) {
      triggerPreviewGeneration();
    }
  };

  filterGrayscaleInput.addEventListener('input', onFilterChange);
  filterSaturationInput.addEventListener('input', onFilterChange);
  filterOpacityInput.addEventListener('input', onFilterChange);
  filterBlurInput.addEventListener('input', onFilterChange);

  btnResetFilters.addEventListener('click', () => {
    filterGrayscaleInput.value = 0;
    filterSaturationInput.value = 100;
    filterOpacityInput.value = 100;
    filterBlurInput.value = 0;
    onFilterChange();
  });

  // Floating Map Navigation controls
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    if (map) {
      map.setZoom(map.getZoom() + 1);
    }
  });

  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    if (map) {
      map.setZoom(map.getZoom() - 1);
    }
  });

  document.getElementById('btn-recenter').addEventListener('click', () => {
    if (map) {
      map.setCenter({ lat: state.startLat, lng: state.startLng });
      map.setZoom(20);
    }
  });

  document.getElementById('btn-zoom-fit').addEventListener('click', () => {
    if (!map || state.zones.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    let hasPolygons = false;

    state.zones.forEach(zone => {
      if (!zone.visible) return;
      zone.polygons.forEach(polygon => {
        const path = polygon.getPath();
        for (let i = 0; i < path.getLength(); i++) {
          bounds.extend(path.getAt(i));
          hasPolygons = true;
        }
      });
    });

    if (hasPolygons) {
      map.fitBounds(bounds);
      // Prevent zooming too far in on single small point
      const listener = google.maps.event.addListener(map, 'idle', () => {
        if (map.getZoom() > 21) {
          map.setZoom(21);
        }
        google.maps.event.removeListener(listener);
      });
    } else {
      alert('No drawn shapes found to fit inside the viewport.');
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Only capture if user is not typing in an input or textarea
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      return;
    }

    if (e.key === '+' || e.key === '=') {
      if (map) map.setZoom(map.getZoom() + 1);
    } else if (e.key === '-') {
      if (map) map.setZoom(map.getZoom() - 1);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedPolygon) {
        e.preventDefault();
        try {
          if (confirm('Are you sure you want to delete the selected shape?')) {
            deletePolygon(state.selectedPolygon);
          }
        } catch (err) {
          console.error('Error in keydown delete:', err);
        }
      }
    }
  });

  // Re-generate preview when export modal options change
  document.getElementById('export-title-input').addEventListener('input', debounce(triggerPreviewGeneration, 500));
  document.getElementById('export-subtitle-input').addEventListener('input', debounce(triggerPreviewGeneration, 500));
  document.getElementById('chk-show-legend').addEventListener('change', triggerPreviewGeneration);
  document.getElementById('chk-show-north').addEventListener('change', triggerPreviewGeneration);
  document.getElementById('chk-show-area').addEventListener('change', triggerPreviewGeneration);

  document.querySelectorAll('input[name="export-engine"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      // Toggle CSS selection
      document.querySelectorAll('.engine-option').forEach(el => el.classList.remove('active'));
      const activeLabelId = e.target.value === 'static' ? 'engine-static-label' : 'engine-canvas-label';
      document.getElementById(activeLabelId).classList.add('active');
      triggerPreviewGeneration();
    });
  });

  // Hydrawise Sync UI toggles and operations
  const toggleSyncBtn = document.getElementById('btn-toggle-sync');
  const syncContent = document.getElementById('sync-panel-content');
  toggleSyncBtn.addEventListener('click', () => {
    const isCollapsed = syncContent.classList.contains('collapsed');
    if (isCollapsed) {
      syncContent.classList.remove('collapsed');
      toggleSyncBtn.classList.add('open');
    } else {
      syncContent.classList.add('collapsed');
      toggleSyncBtn.classList.remove('open');
    }
  });

  const hydrawiseKeyInput = document.getElementById('hydrawise-api-key');
  const apiControllersLink = document.getElementById('hydrawise-api-controllers-link');
  const apiZonesLink = document.getElementById('hydrawise-api-zones-link');
  const controllerSelectGroup = document.getElementById('hydrawise-controller-select-group');
  const controllerSelect = document.getElementById('hydrawise-controller-select');

  let controllersList = [];
  let hydrawiseApiKey = '';

  hydrawiseKeyInput.addEventListener('input', () => {
    const key = hydrawiseKeyInput.value.trim();
    hydrawiseApiKey = key;
    if (key) {
      localStorage.setItem('hydrawise_developer_key', key);
      apiControllersLink.href = `https://api.hydrawise.com/api/v1/customerdetails.php?api_key=${key}`;
      apiControllersLink.classList.remove('hidden');
    } else {
      localStorage.removeItem('hydrawise_developer_key');
      localStorage.removeItem('hydrawise_saved_controllers');
      localStorage.removeItem('hydrawise_selected_controller');
      apiControllersLink.href = '#';
      apiControllersLink.classList.add('hidden');
      controllerSelectGroup.classList.add('hidden');
      document.getElementById('sync-step-info-3').classList.add('hidden');
    }
  });

  // Populate controllers select dropdown and update instructions
  function populateControllers(data) {
    if (!data.controllers || !Array.isArray(data.controllers)) {
      alert('Could not identify any controllers in the JSON data. Please verify the response.');
      return;
    }

    controllersList = data.controllers;
    
    // Clear select dropdown
    controllerSelect.innerHTML = '';
    
    if (controllersList.length === 0) {
      alert('No controllers found linked to this account.');
      return;
    }

    // Populate options
    controllersList.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.controller_id;
      opt.textContent = `${c.name || 'Controller'} (ID: ${c.controller_id})`;
      controllerSelect.appendChild(opt);
    });

    // Save to localStorage
    localStorage.setItem('hydrawise_saved_controllers', JSON.stringify(data));
    
    // Save current selection if not already saved
    if (!localStorage.getItem('hydrawise_selected_controller')) {
      localStorage.setItem('hydrawise_selected_controller', controllerSelect.value);
    }

    // Reveal dropdown select group
    controllerSelectGroup.classList.remove('hidden');
    
    // Update step 3 instructions and show them
    document.getElementById('sync-step-info-3').classList.remove('hidden');
    updateZonesLink();

    // Enable direct fetch zones and parse buttons
    document.getElementById('btn-fetch-hydrawise').removeAttribute('disabled');
    document.getElementById('btn-import-json').removeAttribute('disabled');
  }

  function updateZonesLink() {
    const selectedControllerId = controllerSelect.value;
    if (hydrawiseApiKey && selectedControllerId) {
      apiZonesLink.href = `https://api.hydrawise.com/api/v1/statusschedule.php?api_key=${hydrawiseApiKey}&controller_id=${selectedControllerId}&type=readdata`;
      apiZonesLink.classList.remove('hidden');
    }
  }

  // Update zones link when controller selection changes and save selection to localStorage
  controllerSelect.addEventListener('change', () => {
    localStorage.setItem('hydrawise_selected_controller', controllerSelect.value);
    updateZonesLink();
  });

  // Load saved Hydrawise API key and controllers on initialization
  const savedDevKey = localStorage.getItem('hydrawise_developer_key');
  if (savedDevKey) {
    hydrawiseKeyInput.value = savedDevKey;
    hydrawiseApiKey = savedDevKey;
    apiControllersLink.href = `https://api.hydrawise.com/api/v1/customerdetails.php?api_key=${savedDevKey}`;
    apiControllersLink.classList.remove('hidden');
    
    const savedControllers = localStorage.getItem('hydrawise_saved_controllers');
    if (savedControllers) {
      try {
        const parsedControllers = JSON.parse(savedControllers);
        populateControllers(parsedControllers);
        
        const savedSelectedController = localStorage.getItem('hydrawise_selected_controller');
        if (savedSelectedController && Array.from(controllerSelect.options).some(o => o.value === savedSelectedController)) {
          controllerSelect.value = savedSelectedController;
          updateZonesLink();
        }
      } catch (err) {
        console.error('Failed to parse saved controllers:', err);
      }
    }
  }

  // Button: Fetch Controllers via API
  document.getElementById('btn-fetch-hydrawise-controllers').addEventListener('click', () => {
    const key = hydrawiseKeyInput.value.trim();
    if (!key) {
      alert('Please enter your Hydrawise API Key first.');
      return;
    }

    const btn = document.getElementById('btn-fetch-hydrawise-controllers');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Fetching...';
    btn.setAttribute('disabled', 'true');

    fetch(`https://api.hydrawise.com/api/v1/customerdetails.php?api_key=${key}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        populateControllers(data);
        alert('Controllers loaded successfully! Choose your active controller and click "Fetch Zones".');
      })
      .catch(err => {
        console.error(err);
        alert('Direct API fetch failed (CORS policy blocked). Please copy the link in Step 2, open it in a new tab, copy the result, paste it below, and click "Parse Controllers".');
      })
      .finally(() => {
        btn.innerHTML = oldHtml;
        btn.removeAttribute('disabled');
      });
  });

  // Button: Parse Controllers from JSON text
  document.getElementById('btn-parse-controllers').addEventListener('click', () => {
    const jsonInput = document.getElementById('hydrawise-json-input');
    const rawJson = jsonInput.value.trim();
    if (!rawJson) {
      alert('Please paste the raw JSON text from the Controllers link first.');
      return;
    }

    try {
      const data = JSON.parse(rawJson);
      populateControllers(data);
      jsonInput.value = ''; // Reset input to let them paste zones next
      alert('Controllers parsed successfully! Select your controller in the dropdown, open the link in Step 3, paste the zones JSON here, and click "Parse & Import".');
    } catch (e) {
      console.error(e);
      alert('Failed to parse JSON. Please verify that you copied the complete text content.');
    }
  });

  // Button: Fetch Zones via API
  document.getElementById('btn-fetch-hydrawise').addEventListener('click', () => {
    const key = hydrawiseKeyInput.value.trim();
    const controllerId = controllerSelect.value;
    if (!key || !controllerId) {
      alert('Please select a controller first.');
      return;
    }

    const fetchBtn = document.getElementById('btn-fetch-hydrawise');
    const oldHtml = fetchBtn.innerHTML;
    fetchBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Fetching...';
    fetchBtn.setAttribute('disabled', 'true');

    fetch(`https://api.hydrawise.com/api/v1/statusschedule.php?api_key=${key}&controller_id=${controllerId}&type=readdata`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        const count = importHydrawiseZones(data);
        if (count > 0) {
          alert(`Successfully imported ${count} zone(s) from your controller!`);
          
          // Collapse panel, keeping API Key & selected controllers saved
          syncContent.classList.add('collapsed');
          toggleSyncBtn.classList.remove('open');
        }
      })
      .catch(err => {
        console.error(err);
        alert('Direct zones fetch failed (CORS block). Please open the URL in Step 3 in a new tab, copy the result, paste it below, and click "Parse & Import".');
      })
      .finally(() => {
        fetchBtn.innerHTML = oldHtml;
        fetchBtn.removeAttribute('disabled');
      });
  });

  // Button: Parse & Import Zones JSON text
  document.getElementById('btn-import-json').addEventListener('click', () => {
    const jsonInput = document.getElementById('hydrawise-json-input');
    const rawJson = jsonInput.value.trim();
    if (!rawJson) {
      alert('Please paste the zones JSON response from the URL in Step 3 first.');
      return;
    }

    try {
      const data = JSON.parse(rawJson);
      const count = importHydrawiseZones(data);
      if (count > 0) {
        alert(`Successfully parsed and imported ${count} zone(s)!`);
        
        // Reset only JSON text inputs, keeping key & selection populated
        jsonInput.value = '';
        syncContent.classList.add('collapsed');
        toggleSyncBtn.classList.remove('open');
      } else {
        alert('No new zones found in the JSON content.');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to parse JSON. Please make sure you copied the entire text content from the link.');
    }
  });

  // Hide context menu on click anywhere on the page
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('map-context-menu');
    if (menu && !menu.contains(e.target)) {
      hideContextMenu();
    }
  });
}

/**
 * Update map visual CSS filters and label displays
 */
function updateMapFilters() {
  const grayscaleInput = document.getElementById('map-filter-grayscale');
  const saturationInput = document.getElementById('map-filter-saturation');
  const opacityInput = document.getElementById('map-filter-opacity');
  const blurInput = document.getElementById('map-filter-blur');

  if (!grayscaleInput || !saturationInput || !opacityInput || !blurInput) return;

  const grayscale = grayscaleInput.value;
  const saturation = saturationInput.value;
  const opacity = opacityInput.value;
  const blur = blurInput.value;

  // Update DOM labels
  document.getElementById('val-grayscale').textContent = `${grayscale}%`;
  document.getElementById('val-saturation').textContent = `${saturation}%`;
  document.getElementById('val-opacity').textContent = `${opacity}%`;
  document.getElementById('val-blur').textContent = `${blur}px`;

  // Update CSS variable on the map container
  const mapEl = document.getElementById('map');
  if (mapEl) {
    const filterVal = `grayscale(${grayscale}%) saturate(${saturation}%) opacity(${opacity}%) blur(${blur}px)`;
    mapEl.style.setProperty('--map-image-filter', filterVal);
  }

  // Update state
  state.mapGrayscale = parseInt(grayscale);
  state.mapSaturation = parseInt(saturation);
  state.mapOpacity = parseInt(opacity);
  state.mapBlur = parseFloat(blur);

  // Save dynamically to localStorage config
  const savedConfig = localStorage.getItem('hydrawise_map_config');
  if (savedConfig) {
    try {
      const config = JSON.parse(savedConfig);
      config.mapGrayscale = state.mapGrayscale;
      config.mapSaturation = state.mapSaturation;
      config.mapOpacity = state.mapOpacity;
      config.mapBlur = state.mapBlur;
      localStorage.setItem('hydrawise_map_config', JSON.stringify(config));
    } catch (e) {
      console.error(e);
    }
  }
}

/**
 * Handle Sidebar Tab Navigation
 */
function setupSidebarTabs() {
  const tabZones = document.getElementById('tab-zones-btn');
  const tabConfig = document.getElementById('tab-config-btn');
  const panelZones = document.getElementById('panel-zones');
  const panelConfig = document.getElementById('panel-config');

  tabZones.addEventListener('click', () => {
    tabZones.classList.add('active');
    tabConfig.classList.remove('active');
    panelZones.classList.add('active');
    panelConfig.classList.remove('active');
  });

  tabConfig.addEventListener('click', () => {
    tabConfig.classList.add('active');
    tabZones.classList.remove('active');
    panelConfig.classList.add('active');
    panelZones.classList.remove('active');
  });
}

/**
 * Toggle unit conversion button active states
 */
function updateUnitButtons() {
  const btnSqft = document.getElementById('btn-unit-sqft');
  const btnSqm = document.getElementById('btn-unit-sqm');
  
  if (state.unit === 'sqft') {
    btnSqft.classList.add('active');
    btnSqm.classList.remove('active');
  } else {
    btnSqm.classList.add('active');
    btnSqft.classList.remove('active');
  }
}

/**
 * Toggle visibility of modals
 */
function toggleModal(id, show) {
  const modal = document.getElementById(id);
  if (show) {
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

/**
 * Add a new irrigation zone to the state
 */
function addNewZone(name, color, type = 'spray', flowRate = 1.5) {
  const zoneId = 'zone_' + Math.random().toString(36).substr(2, 9);
  const newZone = {
    id: zoneId,
    name: name,
    color: color,
    type: type,
    flowRate: flowRate,
    visible: true,
    polygons: []
  };

  state.zones.push(newZone);
  renderZones();
  selectZone(zoneId);
  saveZonesData();

  // Scroll zone list to bottom to show new card
  const list = document.getElementById('zone-list');
  list.scrollTop = list.scrollHeight;
}

/**
 * Parse and import zones from Hydrawise API JSON response
 */
function importHydrawiseZones(data) {
  let zonesToImport = [];

  if (data.relays && Array.isArray(data.relays)) {
    zonesToImport = data.relays;
  } else if (data.zones && Array.isArray(data.zones)) {
    zonesToImport = data.zones;
  } else if (data.controllers && Array.isArray(data.controllers)) {
    data.controllers.forEach(c => {
      if (c.zones && Array.isArray(c.zones)) {
        zonesToImport = zonesToImport.concat(c.zones);
      } else if (c.relays && Array.isArray(c.relays)) {
        zonesToImport = zonesToImport.concat(c.relays);
      }
    });
  } else if (Array.isArray(data)) {
    zonesToImport = data;
  }

  if (zonesToImport.length === 0) {
    alert('No zones could be identified in the JSON data. Please verify the response format.');
    return 0;
  }

  let importCount = 0;
  zonesToImport.forEach(item => {
    const relayNum = item.relay !== undefined ? item.relay : '';
    let name = item.name || '';
    
    if (!name && relayNum) {
      name = `Zone ${relayNum}`;
    } else if (!name) {
      return; // Skip zones without name or relay
    }

    // Prefix with relay number if present
    const prefix = relayNum ? `Z${relayNum} - ` : '';
    if (relayNum && !name.toLowerCase().startsWith('z') && !name.toLowerCase().startsWith('zone')) {
      name = prefix + name;
    }

    // Deduplicate: check if zone already exists
    const exists = state.zones.some(z => z.name.toLowerCase() === name.toLowerCase());
    if (exists) return;

    // Detect type based on keywords in name
    const nameLower = name.toLowerCase();
    let type = 'spray';
    let flowRate = 1.5;

    if (nameLower.includes('drip') || nameLower.includes('tubing') || nameLower.includes('bed')) {
      type = 'drip';
      flowRate = 0.8;
    } else if (nameLower.includes('rotor') || nameLower.includes('lawn') || nameLower.includes('grass')) {
      type = 'rotor';
      flowRate = 2.5;
    } else if (nameLower.includes('micro') || nameLower.includes('spray') || nameLower.includes('emitter')) {
      type = 'micro-drip';
      flowRate = 0.5;
    } else if (nameLower.includes('mainline')) {
      type = 'mainline';
      flowRate = 0;
    } else if (nameLower.includes('lateral')) {
      type = 'lateral';
      flowRate = 0;
    }

    // Pick preset color based on zone number
    const colorIndex = state.zones.length % SPRINKLER_PRESETS.length;
    const color = SPRINKLER_PRESETS[colorIndex].color;

    // Add zone
    const zoneId = 'zone_' + Math.random().toString(36).substr(2, 9);
    state.zones.push({
      id: zoneId,
      name: name,
      color: color,
      type: type,
      flowRate: flowRate,
      visible: true,
      polygons: []
    });

    importCount++;
  });

  if (importCount > 0) {
    renderZones();
    // Select first imported zone
    const lastZone = state.zones[state.zones.length - 1];
    if (lastZone) {
      selectZone(lastZone.id);
    }
    saveZonesData();
  }

  return importCount;
}

/**
 * Select a zone to activate drawing/editing controls
 */
function selectZone(zoneId) {
  state.activeZoneId = zoneId;
  
  // Highlight card in UI
  document.querySelectorAll('.zone-card').forEach(card => {
    if (card.dataset.id === zoneId) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });

  // Reset selected polygon if it doesn't belong to the newly selected zone
  if (state.selectedPolygon) {
    const parentZone = state.zones.find(z => z.polygons.includes(state.selectedPolygon));
    if (!parentZone || parentZone.id !== zoneId) {
      state.selectedPolygon = null;
    }
  }

  updatePolygonStyles();

  // Auto-close sidebar drawer on mobile to reveal map view on selection
  toggleSidebar(false);

  // Update floating draw button UI
  updateFloatingDrawButtonUI();
}

/**
 * Update visual options of all polygons on the map based on active zone and selection
 */
function updatePolygonStyles() {
  state.zones.forEach(z => {
    const isActive = z.id === state.activeZoneId;
    z.polygons.forEach(polygon => {
      const isSelected = polygon === state.selectedPolygon;
      polygon.setOptions({
        strokeColor: isSelected ? '#ffffff' : z.color,
        strokeWeight: isSelected ? 5 : (isActive ? 3 : 1.5),
        fillOpacity: isSelected ? 0.65 : (isActive ? 0.5 : 0.3),
        editable: isActive // Only active zone polygons are editable
      });
    });
  });
}

/**
 * Update the visibility and content of the mobile/desktop floating draw button
 */
function updateFloatingDrawButtonUI() {
  const btn = document.getElementById('btn-floating-draw');
  if (!btn) return;

  if (state.activeZoneId && !state.isDrawing) {
    const activeZone = state.zones.find(z => z.id === state.activeZoneId);
    if (activeZone) {
      btn.innerHTML = `<i class="fa-solid fa-draw-polygon"></i> Draw Shape (${activeZone.name})`;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  } else {
    btn.classList.add('hidden');
  }
}

/**
 * Set a specific polygon as selected and highlight it
 */
function selectPolygon(polygon) {
  if (state.selectedPolygon === polygon) return;

  state.selectedPolygon = polygon;

  if (polygon) {
    const parentZone = state.zones.find(z => z.polygons.includes(polygon));
    if (parentZone && state.activeZoneId !== parentZone.id) {
      selectZone(parentZone.id);
    } else {
      updatePolygonStyles();
    }
  } else {
    updatePolygonStyles();
  }
}

/**
 * Delete a polygon from the map and state
 */
function deletePolygon(polygon) {
  if (!polygon) return;

  // Disable editing and dragging to cleanly remove edit handles/markers
  polygon.setEditable(false);
  polygon.setOptions({ editable: false, draggable: false });

  // Remove from map
  polygon.setMap(null);

  // Clear listeners to prevent memory leaks
  google.maps.event.clearInstanceListeners(polygon);
  const path = polygon.getPath();
  if (path) {
    google.maps.event.clearInstanceListeners(path);
  }

  // Remove from state
  state.zones.forEach(z => {
    const idx = z.polygons.indexOf(polygon);
    if (idx > -1) {
      z.polygons.splice(idx, 1);
    }
  });

  if (state.selectedPolygon === polygon) {
    state.selectedPolygon = null;
  }

  // Hide context menu
  hideContextMenu();

  // Save changes
  renderZones();
  saveZonesData();

  // Update export preview if open
  const exportModal = document.getElementById('export-modal');
  if (exportModal && !exportModal.classList.contains('hidden')) {
    triggerPreviewGeneration();
  }
}

/**
 * Bind standard path modification listeners, click selection, and right-click context menu
 */
function setupPolygonEvents(polygon, zoneId) {
  // Bind standard coordinates drag/edit listeners
  bindPolygonPathListeners(polygon, zoneId);

  let pressTimer = null;
  let longPressActive = false;

  // Left click: Select zone and select polygon (unless bypassed by long press)
  google.maps.event.addListener(polygon, 'click', (event) => {
    if (longPressActive) {
      longPressActive = false;
      return;
    }
    selectZone(zoneId);
    selectPolygon(polygon);
  });

  // Right click: Select zone, select polygon, show context menu
  google.maps.event.addListener(polygon, 'rightclick', (event) => {
    if (event.domEvent) {
      event.domEvent.preventDefault();
      event.domEvent.stopPropagation();
      
      selectZone(zoneId);
      selectPolygon(polygon);
      
      showContextMenu(event.domEvent.clientX, event.domEvent.clientY, polygon);
    }
  });

  // Long press / Touch hold deletion (opens context menu)
  google.maps.event.addListener(polygon, 'mousedown', (event) => {
    longPressActive = false;
    if (pressTimer) clearTimeout(pressTimer);

    // Extract screen coordinates for context menu position
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    if (event.domEvent) {
      const de = event.domEvent;
      if (de.clientX !== undefined && de.clientY !== undefined) {
        x = de.clientX;
        y = de.clientY;
      } else if (de.touches && de.touches.length > 0) {
        x = de.touches[0].clientX;
        y = de.touches[0].clientY;
      } else if (de.changedTouches && de.changedTouches.length > 0) {
        x = de.changedTouches[0].clientX;
        y = de.changedTouches[0].clientY;
      }
    }

    pressTimer = setTimeout(() => {
      longPressActive = true;
      selectZone(zoneId);
      selectPolygon(polygon);

      // Trigger context menu after a micro-delay to let the event loop process state
      setTimeout(() => {
        showContextMenu(x, y, polygon);
      }, 50);
    }, 750);
  });

  // Cancel long press on release
  google.maps.event.addListener(polygon, 'mouseup', () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  });

  // Cancel long press if user drags/pans
  google.maps.event.addListener(polygon, 'dragstart', () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  });

  // Cancel long press if pointer leaves the polygon
  google.maps.event.addListener(polygon, 'mouseout', () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  });

  // Cancel long press if map is panned
  if (map) {
    google.maps.event.addListener(map, 'dragstart', () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    });
  }
}

/**
 * Display the custom map context menu at the mouse cursor
 */
function showContextMenu(x, y, polygon) {
  const menu = document.getElementById('map-context-menu');
  if (!menu) {
    console.warn('map-context-menu element not found in DOM!');
    return;
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');

  const deleteBtn = document.getElementById('btn-context-delete');
  if (deleteBtn) {
    // Clone and replace to flush previous click listeners
    const newDeleteBtn = deleteBtn.cloneNode(true);
    deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
    
    newDeleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      if (confirm('Are you sure you want to delete this shape?')) {
        deletePolygon(polygon);
      }
    });
  }
}

/**
 * Hide the custom map context menu
 */
function hideContextMenu() {
  const menu = document.getElementById('map-context-menu');
  if (menu) {
    menu.classList.add('hidden');
  }
}

/**
 * Toggle the mobile slide-out sidebar drawer
 */
function toggleSidebar(forceState) {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  const isOpen = sidebar.classList.toggle('open', forceState);
  if (backdrop) {
    backdrop.classList.toggle('hidden', !isOpen);
  }
}

/**
 * Toggle drawing mode on/off
 */
/**
 * Add a point/vertex to the custom drawing path
 */
function addVertexToDrawing(latLng, zone) {
  customDrawing.path.push(latLng);
  customDrawing.polyline.setPath(customDrawing.path);

  // Mark the first point with a small circle so clicking it completes the drawing
  if (customDrawing.path.length === 1) {
    customDrawing.firstPointMarker = new google.maps.Marker({
      position: latLng,
      map: map,
      title: 'Click here to finish shape',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: zone.color,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2
      },
      zIndex: 999
    });

    google.maps.event.addListener(customDrawing.firstPointMarker, 'click', (e) => {
      if (customDrawing.path.length >= 3) {
        finishCustomDrawing();
      }
    });
  }

  // Show "Finish Shape" button if we have at least 3 points
  const finishBtn = document.getElementById('btn-finish-drawing');
  if (finishBtn) {
    if (customDrawing.path.length >= 3) {
      finishBtn.classList.remove('hidden');
    } else {
      finishBtn.classList.add('hidden');
    }
  }
}

/**
 * Toggle custom drawing mode on/off
 */
function startDrawingMode(zoneId) {
  selectZone(zoneId);
  const zone = state.zones.find(z => z.id === zoneId);
  if (!zone) return;

  state.isDrawing = true;
  customDrawing.zoneId = zoneId;
  customDrawing.path = [];
  customDrawing.listeners = [];

  // Create temporary Polyline representing the shape boundary being drawn
  customDrawing.polyline = new google.maps.Polyline({
    strokeColor: zone.color,
    strokeOpacity: 0.8,
    strokeWeight: 3,
    map: map
  });

  // Temporarily disable map double-click zoom to handle manual double-click completion
  map.setOptions({ disableDoubleClickZoom: true });

  // Map Click Listener to add vertices
  const clickListener = google.maps.event.addListener(map, 'click', (event) => {
    addVertexToDrawing(event.latLng, zone);
  });
  customDrawing.listeners.push(clickListener);

  // Map Mousemove Listener to draw drag line preview to current cursor location
  const moveListener = google.maps.event.addListener(map, 'mousemove', (event) => {
    if (customDrawing.path.length > 0) {
      const previewPath = [...customDrawing.path, event.latLng];
      customDrawing.polyline.setPath(previewPath);
    }
  });
  customDrawing.listeners.push(moveListener);

  // Map Double Click Listener to finish shape
  const dblclickListener = google.maps.event.addListener(map, 'dblclick', (event) => {
    if (customDrawing.path.length >= 3) {
      finishCustomDrawing();
    }
  });
  customDrawing.listeners.push(dblclickListener);

  // Display drawing banner
  const isMobile = window.innerWidth <= 768;
  const instructionText = isMobile
    ? `Drawing mode active: Draw boundaries for ${zone.name}. Tap map to add vertices. Tap 'Finish Shape' or the first point to complete.`
    : `Drawing mode active: Draw boundaries for ${zone.name}. Click map to add vertices, double-click or click the first point to complete.`;
  document.getElementById('drawing-banner-text').textContent = instructionText;
  document.getElementById('drawing-banner').classList.remove('hidden');

  // Update floating draw button UI
  updateFloatingDrawButtonUI();
}

/**
 * Cancel custom drawing mode and reset state cleanups
 */
function cancelDrawingMode() {
  state.isDrawing = false;
  document.getElementById('drawing-banner').classList.add('hidden');

  const finishBtn = document.getElementById('btn-finish-drawing');
  if (finishBtn) finishBtn.classList.add('hidden');

  // Re-enable map double click zoom
  if (map) {
    map.setOptions({ disableDoubleClickZoom: false });
  }

  // Clear event listeners
  if (customDrawing.listeners) {
    customDrawing.listeners.forEach(l => google.maps.event.removeListener(l));
    customDrawing.listeners = [];
  }

  // Clear polyline
  if (customDrawing.polyline) {
    customDrawing.polyline.setMap(null);
    customDrawing.polyline = null;
  }

  // Clear first point marker
  if (customDrawing.firstPointMarker) {
    customDrawing.firstPointMarker.setMap(null);
    customDrawing.firstPointMarker = null;
  }

  customDrawing.path = [];
  customDrawing.zoneId = null;

  // Update floating draw button UI
  updateFloatingDrawButtonUI();
}

/**
 * Complete the custom drawing shape and save to active zone
 */
function finishCustomDrawing() {
  const zone = state.zones.find(z => z.id === customDrawing.zoneId);
  if (!zone) {
    cancelDrawingMode();
    return;
  }

  // Filter out any consecutive duplicate points (e.g. from rapid double-click)
  const cleanPath = [];
  customDrawing.path.forEach(pt => {
    if (cleanPath.length === 0) {
      cleanPath.push(pt);
    } else {
      const prev = cleanPath[cleanPath.length - 1];
      const diffLat = Math.abs(pt.lat() - prev.lat());
      const diffLng = Math.abs(pt.lng() - prev.lng());
      if (diffLat > 1e-7 || diffLng > 1e-7) {
        cleanPath.push(pt);
      }
    }
  });

  if (cleanPath.length >= 3) {
    // Instantiate actual Polygon with current zone colors
    const polygon = new google.maps.Polygon({
      paths: cleanPath,
      fillColor: zone.color,
      fillOpacity: 0.5,
      strokeColor: zone.color,
      strokeWeight: 3,
      clickable: true,
      editable: true,
      zIndex: 1,
      map: map
    });

    // Add to state and setup events
    zone.polygons.push(polygon);
    setupPolygonEvents(polygon, zone.id);
    selectPolygon(polygon);
  }

  // Exit drawing mode
  cancelDrawingMode();

  // Save changes
  renderZones();
  saveZonesData();
}

/**
 * Bind listeners to polygon paths to detect changes in vertices
 */
function bindPolygonPathListeners(polygon, zoneId) {
  const path = polygon.getPath();
  
  const handlePathChange = () => {
    renderZones();
    saveZonesData();
  };

  google.maps.event.addListener(path, 'insert_at', handlePathChange);
  google.maps.event.addListener(path, 'remove_at', handlePathChange);
  google.maps.event.addListener(path, 'set_at', handlePathChange);
}

/**
 * Delete a specific polygon of a zone by index
 */
function deletePolygonByIndex(zoneId, index) {
  const zone = state.zones.find(z => z.id === zoneId);
  if (!zone) return;

  const polygon = zone.polygons[index];
  if (polygon) {
    deletePolygon(polygon);
  }
}

/**
 * Delete an entire irrigation zone
 */
function deleteZone(zoneId) {
  const zoneIndex = state.zones.findIndex(z => z.id === zoneId);
  if (zoneIndex === -1) return;

  const zone = state.zones[zoneIndex];
  
  // Remove polygons from Map
  zone.polygons.forEach(p => p.setMap(null));

  // Remove from state
  state.zones.splice(zoneIndex, 1);

  if (state.activeZoneId === zoneId) {
    state.activeZoneId = state.zones.length > 0 ? state.zones[0].id : null;
  }

  renderZones();
  selectZone(state.activeZoneId);
  saveZonesData();
}

/**
 * Toggle zone visible on map
 */
function toggleZoneVisibility(zoneId) {
  const zone = state.zones.find(z => z.id === zoneId);
  if (!zone) return;

  zone.visible = !zone.visible;
  
  zone.polygons.forEach(polygon => {
    polygon.setMap(zone.visible ? map : null);
  });

  renderZones();
  saveZonesData();
}

/**
 * Update details of a zone
 */
function updateZoneDetails(zoneId, key, value) {
  const zone = state.zones.find(z => z.id === zoneId);
  if (!zone) return;

  zone[key] = value;

  // If changing color, update polygon styles on map
  if (key === 'color') {
    zone.polygons.forEach(p => {
      p.setOptions({
        fillColor: value,
        strokeColor: value
      });
    });
  }

  renderZones();
  saveZonesData();
}

/**
 * Calculate the area of a Google Maps Polygon in square meters
 */
function getPolygonArea(polygon) {
  if (!google.maps.geometry || !google.maps.geometry.spherical) {
    return 0;
  }
  return google.maps.geometry.spherical.computeArea(polygon.getPath());
}

/**
 * Convert area in square meters to user selected unit
 */
function formatArea(areaSqM) {
  if (state.unit === 'sqft') {
    const areaSqFt = areaSqM * 10.76391;
    return `${Math.round(areaSqFt).toLocaleString()} sq ft`;
  } else {
    return `${Math.round(areaSqM).toLocaleString()} m²`;
  }
}

/**
 * Render all zones in the sidebar and update legend/export buttons
 */
function renderZones() {
  const zoneListContainer = document.getElementById('zone-list');
  const emptyPrompt = document.getElementById('empty-zones-prompt');
  
  // Clean dynamic contents
  // Keep empty state element, but hide/show it
  const cards = zoneListContainer.querySelectorAll('.zone-card');
  cards.forEach(c => c.remove());

  let totalAreaSqM = 0;

  if (state.zones.length === 0) {
    emptyPrompt.classList.remove('hidden');
    document.getElementById('btn-export-trigger').setAttribute('disabled', 'true');
  } else {
    emptyPrompt.classList.add('hidden');
    document.getElementById('btn-export-trigger').removeAttribute('disabled');

    // Build zone cards
    state.zones.forEach(zone => {
      let zoneAreaSqM = 0;
      zone.polygons.forEach(p => {
        zoneAreaSqM += getPolygonArea(p);
      });
      totalAreaSqM += zoneAreaSqM;

      const isCollapsed = state.activeZoneId !== zone.id;
      
      const card = document.createElement('div');
      card.className = `zone-card ${state.activeZoneId === zone.id ? 'active' : ''}`;
      card.dataset.id = zone.id;

      card.innerHTML = `
        <div class="zone-card-header">
          <div class="zone-card-info">
            <span class="zone-color-indicator" style="background-color: ${zone.color};"></span>
            <div class="zone-details">
              <span class="zone-name">${escapeHtml(zone.name)}</span>
              <span class="zone-subtitle">${zone.polygons.length} polygon${zone.polygons.length !== 1 ? 's' : ''} • ${formatArea(zoneAreaSqM)}</span>
            </div>
          </div>
          <div class="zone-card-actions">
            <button class="btn-icon btn-toggle-vis" title="Toggle Map Visibility">
              <i class="fa-solid ${zone.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>
            </button>
            <button class="btn-icon btn-draw-polygon" title="Add Polygon Area">
              <i class="fa-solid fa-draw-polygon"></i>
            </button>
            <button class="btn-icon btn-delete-zone" title="Delete Zone">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
        <div class="zone-card-body ${isCollapsed ? 'collapsed' : ''}">
          <div class="form-group row">
            <div>
              <label>Zone Name</label>
              <input type="text" class="zone-rename-input" value="${escapeHtml(zone.name)}">
            </div>
          </div>
          <div class="zone-props-row">
            <span>Water Style</span>
            <select class="zone-type-select">
              <option value="spray" ${zone.type === 'spray' ? 'selected' : ''}>Spray Sprinkler</option>
              <option value="rotor" ${zone.type === 'rotor' ? 'selected' : ''}>Rotor Sprinkler</option>
              <option value="drip" ${zone.type === 'drip' ? 'selected' : ''}>Drip Tubing</option>
              <option value="micro-drip" ${zone.type === 'micro-drip' ? 'selected' : ''}>Micro-Spray</option>
              <option value="lateral" ${zone.type === 'lateral' ? 'selected' : ''}>Lateral Line</option>
              <option value="mainline" ${zone.type === 'mainline' ? 'selected' : ''}>Mainline</option>
            </select>
          </div>
          <div class="zone-props-row">
            <span>Flow Rate (GPM)</span>
            <input type="number" class="zone-flow-input" value="${zone.flowRate || 1.5}" step="0.1" min="0">
          </div>
          
          <div class="zone-color-selector">
            <span>Styling Color</span>
            <div class="color-presets-row">
              ${SPRINKLER_PRESETS.map(p => `
                <span class="color-dot ${zone.color.toLowerCase() === p.color.toLowerCase() ? 'active' : ''}" 
                      style="background-color: ${p.color};" 
                      data-color="${p.color}"></span>
              `).join('')}
              <input type="color" class="custom-color-input" value="${zone.color}">
            </div>
          </div>

          ${zone.polygons.length > 0 ? `
            <div class="polygon-list-container">
              <div class="polygon-list-header">
                <span>Drawn Shapes</span>
                <span>Area</span>
              </div>
              ${zone.polygons.map((p, idx) => `
                <div class="polygon-item">
                  <span>Shape #${idx + 1}</span>
                  <div>
                    <span style="margin-right: 8px;">${formatArea(getPolygonArea(p))}</span>
                    <button class="btn-icon btn-delete-poly" data-index="${idx}" style="padding: 2px; color: var(--accent-danger)">
                      <i class="fa-solid fa-circle-xmark"></i>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;

      // Event: Header click to collapse/select
      card.querySelector('.zone-card-header').addEventListener('click', (e) => {
        // Exclude icon button clicks
        if (e.target.closest('.btn-icon')) return;
        selectZone(zone.id);
        renderZones();
      });

      // Actions Event Listeners
      card.querySelector('.btn-toggle-vis').addEventListener('click', () => toggleZoneVisibility(zone.id));
      card.querySelector('.btn-draw-polygon').addEventListener('click', () => startDrawingMode(zone.id));
      card.querySelector('.btn-delete-zone').addEventListener('click', () => {
        if (confirm(`Are you sure you want to delete ${zone.name}?`)) {
          deleteZone(zone.id);
        }
      });

      // Body input change listeners
      const renameInput = card.querySelector('.zone-rename-input');
      if (renameInput) {
        renameInput.addEventListener('change', (e) => {
          updateZoneDetails(zone.id, 'name', e.target.value.trim() || zone.name);
        });
      }

      const typeSelect = card.querySelector('.zone-type-select');
      if (typeSelect) {
        typeSelect.addEventListener('change', (e) => {
          updateZoneDetails(zone.id, 'type', e.target.value);
        });
      }

      const flowInput = card.querySelector('.zone-flow-input');
      if (flowInput) {
        flowInput.addEventListener('change', (e) => {
          const val = parseFloat(e.target.value);
          updateZoneDetails(zone.id, 'flowRate', isNaN(val) ? 0 : val);
        });
      }

      // Presets Color selections
      card.querySelectorAll('.color-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
          updateZoneDetails(zone.id, 'color', e.target.dataset.color);
        });
      });

      const colorInput = card.querySelector('.custom-color-input');
      if (colorInput) {
        colorInput.addEventListener('input', (e) => {
          updateZoneDetails(zone.id, 'color', e.target.value);
        });
      }

      // Polygon deletes
      card.querySelectorAll('.btn-delete-poly').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const index = parseInt(btn.dataset.index);
          deletePolygonByIndex(zone.id, index);
        });
      });

      zoneListContainer.appendChild(card);
    });
  }

  // Update total Area summary
  document.getElementById('total-area-val').textContent = formatArea(totalAreaSqM);

  // Update Interactive Map overlay legend
  updateMapLegendUI(totalAreaSqM);

  // Update floating draw button UI
  updateFloatingDrawButtonUI();
}

/**
 * Update the floating legend panel overlay over the Google map
 */
function updateMapLegendUI(totalAreaSqM) {
  const legend = document.getElementById('map-legend-overlay');
  
  if (state.zones.length === 0) {
    legend.classList.add('hidden');
    return;
  }

  legend.classList.remove('hidden');
  const tbody = document.getElementById('legend-overlay-table').querySelector('tbody');
  tbody.innerHTML = '';

  state.zones.forEach(zone => {
    if (!zone.visible) return;

    let zoneAreaSqM = 0;
    zone.polygons.forEach(p => {
      zoneAreaSqM += getPolygonArea(p);
    });

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="zone-color-indicator" style="background-color: ${zone.color}; vertical-align: middle; margin-right: 6px;"></span>
        ${escapeHtml(zone.name)}
      </td>
      <td>${capitalizeFirstLetter(zone.type)}</td>
      <td class="text-right">${formatArea(zoneAreaSqM)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Add total row
  const totalTr = document.createElement('tr');
  totalTr.style.borderTop = '1px solid var(--border-color)';
  totalTr.style.fontWeight = 'bold';
  totalTr.innerHTML = `
    <td>Total Coverage</td>
    <td></td>
    <td class="text-right">${formatArea(totalAreaSqM)}</td>
  `;
  tbody.appendChild(totalTr);
}

/**
 * Save current state (zones information and coordinates) to localStorage
 */
function saveZonesData() {
  const serializedZones = state.zones.map(z => {
    return {
      id: z.id,
      name: z.name,
      color: z.color,
      type: z.type,
      flowRate: z.flowRate,
      visible: z.visible,
      paths: z.polygons.map(polygon => {
        const path = polygon.getPath();
        const coords = [];
        for (let i = 0; i < path.getLength(); i++) {
          coords.push({
            lat: path.getAt(i).lat(),
            lng: path.getAt(i).lng()
          });
        }
        return coords;
      })
    };
  });

  localStorage.setItem('hydrawise_zones_data', JSON.stringify(serializedZones));
}

/**
 * Load saved zones from localStorage and draw on Google map
 */
function loadSavedZones() {
  const savedData = localStorage.getItem('hydrawise_zones_data');
  if (!savedData) return;

  try {
    const serializedZones = JSON.parse(savedData);
    
    serializedZones.forEach(serialized => {
      const polygons = [];
      
      // Recreate Google Polygon instances
      serialized.paths.forEach(coords => {
        const polygon = new google.maps.Polygon({
          paths: coords,
          fillColor: serialized.color,
          fillOpacity: 0.3,
          strokeColor: serialized.color,
          strokeWeight: 1.5,
          clickable: true,
          editable: false,
          zIndex: 1,
          map: serialized.visible ? map : null
        });

        // Add path, click, and right-click event listeners
        setupPolygonEvents(polygon, serialized.id);

        polygons.push(polygon);
      });

      state.zones.push({
        id: serialized.id,
        name: serialized.name,
        color: serialized.color,
        type: serialized.type || 'spray',
        flowRate: serialized.flowRate || 1.5,
        visible: serialized.visible !== undefined ? serialized.visible : true,
        polygons: polygons
      });
    });

    renderZones();
    if (state.zones.length > 0) {
      selectZone(state.zones[0].id);
    }
  } catch (e) {
    console.error('Failed to parse zones cache', e);
  }
}

/**
 * Open the Export Settings panel and trigger initial render preview
 */
function openExportModal() {
  // Transfer current address label to export settings subtitle if blank
  if (state.address) {
    document.getElementById('export-subtitle-input').value = state.address;
  }

  toggleModal('export-modal', true);
  triggerPreviewGeneration();
}

/**
 * Run preview rendering with brief delay
 */
let previewBlob = null;
function triggerPreviewGeneration() {
  const previewImg = document.getElementById('export-preview-img');
  const errorDiv = document.getElementById('export-preview-error');
  const spinner = document.getElementById('preview-spinner');

  previewImg.classList.add('hidden');
  errorDiv.classList.add('hidden');
  spinner.classList.remove('hidden');

  generateExportPreview()
    .then(dataURL => {
      spinner.classList.add('hidden');
      previewImg.src = dataURL;
      previewImg.classList.remove('hidden');
      previewBlob = dataURL;
    })
    .catch(err => {
      console.error(err);
      spinner.classList.add('hidden');
      errorDiv.classList.remove('hidden');
      previewBlob = null;
    });
}

/**
 * Composite rendering export flow
 */
function generateExportPreview() {
  return new Promise((resolve, reject) => {
    const selectedEngine = document.querySelector('input[name="export-engine"]:checked').value;
    
    if (selectedEngine === 'canvas') {
      // Use html2canvas Screen Capture method
      // Temporarily hide UI elements on the map that shouldn't be captured
      const addressBar = document.querySelector('.floating-search');
      const drawingControls = document.getElementById('drawing-banner');
      const mapControls = document.querySelector('.floating-map-controls');
      
      addressBar.style.display = 'none';
      if (drawingControls) drawingControls.style.display = 'none';
      if (mapControls) mapControls.style.display = 'none';

      // Capture map div
      const mapContainer = document.getElementById('map-container-wrapper');
      
      html2canvas(mapContainer, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: null
      }).then(canvas => {
        // Restore controls
        addressBar.style.display = '';
        if (drawingControls) drawingControls.style.display = '';
        if (mapControls) mapControls.style.display = '';
        
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      }).catch(err => {
        addressBar.style.display = '';
        if (drawingControls) drawingControls.style.display = '';
        if (mapControls) mapControls.style.display = '';
        reject(err);
      });

    } else {
      // Use Google Static Maps API Composite Canvas Engine
      const center = map.getCenter();
      const zoom = map.getZoom();
      const apiKey = state.apiKey;
      
      // Standard scale=2 and size=640x500 yields high-res 1280x1000 pixels
      const width = 1280;
      const height = 1000;

      // Construct Static Maps API URL
      let staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${center.lat()},${center.lng()}&zoom=${zoom}&size=640x500&scale=2&maptype=satellite&key=${apiKey}`;

      // Append Polygons to Static Map path parameter
      state.zones.forEach(zone => {
        if (!zone.visible) return;
        
        const cleanHexColor = zone.color.replace('#', '').toLowerCase();
        
        zone.polygons.forEach(polygon => {
          const path = polygon.getPath();
          if (path.getLength() < 3) return; // Must have vertices to form a polygon

          // Format paths: color:0xHEX8|fillcolor:0xHEX8|weight:2|lat1,lng1|lat2,lng2|...
          // Stroke: opacity 100% (ff)
          // Fill: opacity 30% (4d)
          let pathString = `&path=color:0x${cleanHexColor}ff|fillcolor:0x${cleanHexColor}4d|weight:2`;
          
          const coords = [];
          for (let i = 0; i < path.getLength(); i++) {
            // Round coordinates to 5 decimal places to significantly reduce URL string length
            const lat = path.getAt(i).lat().toFixed(5);
            const lng = path.getAt(i).lng().toFixed(5);
            coords.push(`${lat},${lng}`);
          }
          // Close the polygon loop for Static Maps rendering accuracy
          coords.push(coords[0]);

          pathString += `|${coords.join('|')}`;
          
          // Only append if it doesn't break URL length limit
          if ((staticMapUrl + pathString).length < 8000) {
            staticMapUrl += pathString;
          } else {
            console.warn('URL too long, skipping complex polygon layer in static render');
          }
        });
      });

      // Load Static Map image into canvas
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Crucial for reading canvas data later
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // 1. Draw static satellite map tiles + paths with applied visual adjustments
        const filterStr = `grayscale(${state.mapGrayscale}%) saturate(${state.mapSaturation}%) opacity(${state.mapOpacity}%) blur(${state.mapBlur}px)`;
        ctx.filter = filterStr;
        ctx.drawImage(img, 0, 0, width, height);
        ctx.filter = 'none'; // Reset so title, north arrow, and legend are sharp and clean

        // 2. Draw Blueprint Title Block
        const showLegend = document.getElementById('chk-show-legend').checked;
        const showNorth = document.getElementById('chk-show-north').checked;
        const showArea = document.getElementById('chk-show-area').checked;

        const titleVal = document.getElementById('export-title-input').value.trim() || 'Hydrawise Schematic';
        const subtitleVal = document.getElementById('export-subtitle-input').value.trim() || state.address;

        // Draw Title header rectangle (Sleek dark gradient overlay at top)
        const headerH = 130;
        ctx.fillStyle = 'rgba(10, 15, 24, 0.85)';
        ctx.fillRect(0, 0, width, headerH);
        
        // Header separator line
        ctx.strokeStyle = '#2e3b4e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, headerH);
        ctx.lineTo(width, headerH);
        ctx.stroke();

        // Write Title text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px "Outfit", sans-serif';
        ctx.fillText(titleVal.toUpperCase(), 40, 56);

        // Write Subtitle / Address text
        ctx.fillStyle = '#9ca3af';
        ctx.font = '16px "Inter", sans-serif';
        let subtitleText = subtitleVal;
        
        // Sum total areas
        let totalSqM = 0;
        state.zones.forEach(z => {
          if (z.visible) {
            z.polygons.forEach(p => totalSqM += getPolygonArea(p));
          }
        });
        
        if (showArea && totalSqM > 0) {
          subtitleText += `  |  TOTAL MAPPED AREA: ${formatArea(totalSqM)}`;
        }
        ctx.fillText(subtitleText, 40, 94);

        // 3. Draw North Arrow
        if (showNorth) {
          drawNorthArrow(ctx, width - 80, 65, 30);
        }

        // 4. Draw Legend Table Overlay at Bottom Right
        if (showLegend) {
          drawLegendBlock(ctx, width, height, showArea);
        }

        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };

      img.onerror = (err) => {
        reject(new Error('Static Map Image load failed. Check API restrictions.'));
      };

      // Trigger load
      img.src = staticMapUrl;
    }
  });
}

/**
 * Draw minimal engineering North Arrow
 */
function drawNorthArrow(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);

  // Circle background
  ctx.fillStyle = 'rgba(10, 15, 24, 0.7)';
  ctx.strokeStyle = '#2e3b4e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();

  // Compass needle pointing north
  ctx.fillStyle = '#ef4444'; // Red pointer
  ctx.beginPath();
  ctx.moveTo(0, -size + 8);
  ctx.lineTo(-6, 2);
  ctx.lineTo(0, -2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#e2e8f0'; // Light grey south pointer
  ctx.beginPath();
  ctx.moveTo(0, size - 8);
  ctx.lineTo(-6, -2);
  ctx.lineTo(0, 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#cbd5e1'; // Highlight pointer side
  ctx.beginPath();
  ctx.moveTo(0, -size + 8);
  ctx.lineTo(6, 2);
  ctx.lineTo(0, -2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, size - 8);
  ctx.lineTo(6, -2);
  ctx.lineTo(0, 2);
  ctx.closePath();
  ctx.fill();

  // N Text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px "Outfit", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 0, -size - 4);

  ctx.restore();
}

/**
 * Draw structured blueprint legend directly on export canvas
 */
function drawLegendBlock(ctx, canvasW, canvasH, showArea) {
  // Identify how many visible zones we need to display
  const activeZones = state.zones.filter(z => z.visible);
  if (activeZones.length === 0) return;

  const cardW = 380;
  const padding = 24;
  const rowH = 40;
  const headerH = 50;
  const footerH = 36;
  const cardH = headerH + (activeZones.length * rowH) + footerH;

  // Position: bottom right
  const cardX = canvasW - cardW - 40;
  const cardY = canvasH - cardH - 40;

  // Background card panel
  ctx.fillStyle = 'rgba(10, 15, 24, 0.85)';
  ctx.strokeStyle = '#2e3b4e';
  ctx.lineWidth = 2;
  
  // Rounded rectangle path
  const radius = 10;
  ctx.beginPath();
  ctx.moveTo(cardX + radius, cardY);
  ctx.lineTo(cardX + cardW - radius, cardY);
  ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + radius);
  ctx.lineTo(cardX + cardW, cardY + cardH - radius);
  ctx.quadraticCurveTo(cardX + cardW, cardY + cardH, cardX + cardW - radius, cardY + cardH);
  ctx.lineTo(cardX + radius, cardY + cardH);
  ctx.quadraticCurveTo(cardX, cardY + cardH, cardX, cardY + cardH - radius);
  ctx.lineTo(cardX, cardY + radius);
  ctx.quadraticCurveTo(cardX, cardY, cardX + radius, cardY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Header Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px "Outfit", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('ZONE MAP LEGEND', cardX + padding, cardY + 32);

  // Header Line
  ctx.strokeStyle = '#2e3b4e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX + padding, cardY + headerH);
  ctx.lineTo(cardX + cardW - padding, cardY + headerH);
  ctx.stroke();

  // Row entries
  let currentY = cardY + headerH + 26;
  ctx.font = '14px "Inter", sans-serif';

  activeZones.forEach(zone => {
    // 1. Color Circle indicator
    ctx.fillStyle = zone.color;
    ctx.beginPath();
    ctx.arc(cardX + padding + 8, currentY - 5, 8, 0, 2 * Math.PI);
    ctx.fill();

    // Color stroke boundary for contrast
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 2. Zone Name
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = 'bold 14px "Inter", sans-serif';
    
    // Truncate name if too long
    let nameText = zone.name;
    if (nameText.length > 18) nameText = nameText.substring(0, 16) + '...';
    ctx.fillText(nameText, cardX + padding + 28, currentY);

    // 3. Zone Type and Area details
    ctx.fillStyle = '#9ca3af';
    ctx.font = '13px "Inter", sans-serif';
    
    let detailsText = capitalizeFirstLetter(zone.type);
    if (showArea) {
      let zoneAreaSqM = 0;
      zone.polygons.forEach(p => zoneAreaSqM += getPolygonArea(p));
      detailsText += ` (${formatArea(zoneAreaSqM)})`;
    }

    ctx.textAlign = 'right';
    ctx.fillText(detailsText, cardX + cardW - padding, currentY);

    currentY += rowH;
  });

  // Footer Row
  const footerY = cardY + cardH - 14;
  ctx.strokeStyle = '#2e3b4e';
  ctx.beginPath();
  ctx.moveTo(cardX + padding, cardY + cardH - footerH);
  ctx.lineTo(cardX + cardW - padding, cardY + cardH - footerH);
  ctx.stroke();

  ctx.fillStyle = '#6b7280';
  ctx.font = '11px "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('HYDRAWISE SYSTEM SCHEMATIC', cardX + padding, footerY);

  ctx.textAlign = 'right';
  ctx.fillText('SCALE: MAP BOUNDS', cardX + cardW - padding, footerY);
}

/**
 * Execute final image save download
 */
function executeDownload() {
  if (!previewBlob) {
    alert('Please wait for the preview image to load before downloading.');
    return;
  }

  // Create file download link
  const link = document.createElement('a');
  link.href = previewBlob;
  link.download = 'Hydrawise_Aerial_Schematic.jpg';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  toggleModal('export-modal', false);
}

// Helpers
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function capitalizeFirstLetter(string) {
  if (!string) return '';
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
