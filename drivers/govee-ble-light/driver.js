'use strict';

const { Driver } = require('homey');
const { isKnownLightModel } = require('../../lib/govee-ble-light-protocol');

// Govee model code from a BLE local name like "Govee_H617A_54F6".
const MODEL_PATTERN = /^Govee_(H[0-9A-Z]{4})/i;

// homey.ble.discover() reliably takes ~10s (its timeout parameter is
// ignored - a known SDK quirk, see discoverBLELights() below). This is a
// hang safety net set comfortably above that, not the expected wait.
const DISCOVERY_SAFETY_TIMEOUT_MS = 15000;

class GoveeBLELightDriver extends Driver {

  async onInit() {
    this.log('Govee BLE Light driver initialized');
    this._startBackgroundDiscovery();
  }

  _startBackgroundDiscovery() {
    this.log('Starting background BLE discovery...');
    this._discoveryPromise = this.discoverBLELights();
  }

  async onPair(session) {
    if (!this._discoveryPromise || (this._cacheTime && Date.now() - this._cacheTime > 60000)) {
      this._cachedDevices = null;
      this._startBackgroundDiscovery();
    }

    session.setHandler('list_devices', async () => {
      if (this._cachedDevices && this._cachedDevices.length > 0) {
        this.log(`Returning ${this._cachedDevices.length} cached devices`);
        return this._cachedDevices;
      }

      // The underlying scan reliably takes ~10s (see discoverBLELights()).
      // This timeout is a hang safety net, not the expected wait - it's set
      // comfortably above that so a normal cold pair doesn't trip it and pay
      // for a second, redundant wait on top of the real one.
      this.log('Waiting for BLE discovery to complete...');
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('BLE discovery timed out')), DISCOVERY_SAFETY_TIMEOUT_MS)
        );

        const devices = await Promise.race([this._discoveryPromise, timeoutPromise]);
        this._cacheTime = Date.now();
        return devices;
      } catch (err) {
        this.error('BLE discovery did not complete in time:', err.message);
        return [];
      }
    });
  }

  async discoverBLELights() {
    this.log('Starting BLE discovery for Govee lights...');

    // Note: Homey BLE discover timeout parameter is ignored (known SDK bug)
    // The scan always takes ~10 seconds
    const advertisements = await this.homey.ble.discover();

    this.log(`Found ${advertisements.length} BLE devices, filtering for Govee lights...`);

    const devices = [];
    const seenAddresses = new Set();

    for (const advertisement of advertisements) {
      const model = this.extractModel(advertisement.localName || '');
      if (!isKnownLightModel(model)) continue;

      const address = advertisement.address;
      if (seenAddresses.has(address)) continue;
      seenAddresses.add(address);

      this.log(`Found Govee BLE light: ${advertisement.localName} (${model}) - ${address}`);

      devices.push({
        name: `Govee ${model}`,
        data: {
          id: advertisement.uuid
        },
        store: {
          peripheralUuid: advertisement.uuid,
          localName: advertisement.localName,
          model,
          address
        }
      });
    }

    this.log(`Found ${devices.length} Govee BLE lights`);
    this._cachedDevices = devices;
    return devices;
  }

  /**
   * @param {string} localName
   * @returns {string|null}
   */
  extractModel(localName) {
    const match = MODEL_PATTERN.exec(localName);
    return match ? match[1].toUpperCase() : null;
  }

}

module.exports = GoveeBLELightDriver;
