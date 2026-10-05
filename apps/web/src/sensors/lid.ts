import type { SensorDescriptor, SensorHub } from '@sensinth/core';
import { nowSeconds, SourceError, type WebSensorSource } from './source';

/** The bits of WebHID this source uses (Chrome and Edge only, so not in TypeScript's DOM types). */
interface HidDevice {
  opened: boolean;
  productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
}
interface Hid {
  getDevices(): Promise<HidDevice[]>;
  requestDevice(options: { filters: HidFilter[] }): Promise<HidDevice[]>;
}
interface HidFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

/**
 * The MacBook lid sensor: an Apple sensor-hub HID device on the 16-inch
 * MacBook Pro from 2019, M2 and later MacBook Airs and 14/16-inch Pros. Its
 * feature report 1 holds the hinge angle in degrees.
 */
const LID_FILTER: HidFilter = { vendorId: 0x05ac, productId: 0x8104, usagePage: 0x20, usage: 0x8a };

const LID: SensorDescriptor = {
  id: 'mac.lid',
  kind: 'lid.angle',
  label: 'Lid angle',
  unit: '°',
  range: [0, 180],
  adaptive: true,
  minSpan: 20,
  rateHz: 10,
  source: 'mac',
};

/** Reads the angle from a feature report, with or without the report id in front. */
export function lidAngle(report: DataView): number | undefined {
  if (report.byteLength >= 3 && report.getUint8(0) === 1) return report.getUint16(1, true);
  if (report.byteLength >= 2) return report.getUint16(0, true);
  return undefined;
}

/**
 * The lid angle of a MacBook, through WebHID in Chrome or Edge. The first
 * time, the browser asks which device to allow; after that it reconnects on
 * its own. (The Mac app reads it natively, faster.)
 */
export class LidAngleSource implements WebSensorSource {
  readonly id = 'lid';
  readonly label = 'MacBook lid';
  readonly description = 'The hinge angle, in Chrome or Edge on recent MacBooks';
  private device: HidDevice | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private reading = false;

  private get hid(): Hid | undefined {
    return (navigator as Navigator & { hid?: Hid }).hid;
  }

  unsupportedReason(): string | undefined {
    if (!this.hid) return 'Needs Chrome or Edge (WebHID) on a MacBook.';
    if (!/Mac/.test(navigator.platform) && !/Mac OS/.test(navigator.userAgent)) {
      return 'Only MacBooks have this sensor.';
    }
    return undefined;
  }

  async start(hub: SensorHub): Promise<void> {
    const hid = this.hid;
    if (!hid) throw new SourceError('This browser has no WebHID.');
    // A device allowed before reconnects without asking.
    let device = (await hid.getDevices())[0];
    if (!device) {
      try {
        [device] = await hid.requestDevice({ filters: [LID_FILTER] });
      } catch {
        throw new SourceError('Tap again to choose the lid sensor.');
      }
    }
    if (!device) throw new SourceError('No lid sensor chosen (only recent MacBooks have one).');
    if (!device.opened) await device.open();
    this.device = device;
    hub.announce(LID);
    this.timer = setInterval(() => void this.poll(hub), 100);
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    void this.device?.close().catch(() => {});
    this.device = undefined;
    hub.remove(LID.id);
  }

  private async poll(hub: SensorHub): Promise<void> {
    if (!this.device || this.reading) return;
    this.reading = true;
    try {
      const angle = lidAngle(await this.device.receiveFeatureReport(1));
      if (angle !== undefined && angle <= 360) hub.push({ id: LID.id, t: nowSeconds(), v: angle });
    } catch {
      // A missed report; the next poll tries again.
    } finally {
      this.reading = false;
    }
  }
}
