/** Raw printing over WebUSB (Chrome and Edge). Zebra printers and any USB printer-class device. */

export const ZEBRA_VENDOR = 0x0a5f;
const FILTERS: USBDeviceFilter[] = [{ vendorId: ZEBRA_VENDOR }, { classCode: 7 }];
const CHUNK = 16384;

export const hasUsb = () => typeof navigator !== "undefined" && "usb" in navigator;

export interface Printer {
  device: USBDevice;
  name: string;
  isZebra: boolean;
}

let current: { device: USBDevice; iface: number; endpoint: number } | null = null;

const describe = (d: USBDevice): Printer => ({
  device: d,
  name: [d.manufacturerName, d.productName].filter(Boolean).join(" ") || `USB ${hex(d.vendorId)}:${hex(d.productId)}`,
  isZebra: d.vendorId === ZEBRA_VENDOR,
});
const hex = (n: number) => n.toString(16).padStart(4, "0");

/** Interface to print on: the printer-class one, else the first with a bulk OUT endpoint. */
function pick(d: USBDevice): { iface: number; alt: number; endpoint: number } | null {
  const conf = d.configuration;
  if (!conf) return null;
  let fallback: { iface: number; alt: number; endpoint: number } | null = null;
  for (const i of conf.interfaces) {
    for (const a of i.alternates) {
      const out = a.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
      if (!out) continue;
      const hit = { iface: i.interfaceNumber, alt: a.alternateSetting, endpoint: out.endpointNumber };
      if (a.interfaceClass === 7) return hit;
      fallback ??= hit;
    }
  }
  return fallback;
}

async function open(d: USBDevice): Promise<Printer> {
  if (!d.opened) await d.open();
  if (!d.configuration) await d.selectConfiguration(1);
  const p = pick(d);
  if (!p) throw new Error("no USB printer interface");
  await d.claimInterface(p.iface);
  if (p.alt) await d.selectAlternateInterface(p.iface, p.alt);
  current = { device: d, iface: p.iface, endpoint: p.endpoint };
  return describe(d);
}

/** Ask the user to pick a printer (shows the browser's device chooser). */
export async function connect(): Promise<Printer> {
  const d = await navigator.usb.requestDevice({ filters: FILTERS });
  return open(d);
}

/** Reopen a printer the user already allowed on an earlier visit, if it is plugged in. */
export async function reconnect(): Promise<Printer | null> {
  if (!hasUsb()) return null;
  const devices = await navigator.usb.getDevices();
  for (const d of devices) {
    try {
      return await open(d);
    } catch {
      /* try the next one */
    }
  }
  return null;
}

export async function forget(): Promise<void> {
  const d = current?.device;
  current = null;
  if (!d) return;
  try {
    if (d.opened) await d.close();
  } catch {
    /* already gone */
  }
  await d.forget?.();
}

export const connected = () => (current ? describe(current.device) : null);

/** Send raw bytes. Resolves once the transfer completes, which is not the same as printed. */
export async function send(data: Uint8Array): Promise<void> {
  if (!current) throw new Error("no printer connected");
  const { device, endpoint } = current;
  for (let i = 0; i < data.length; i += CHUNK) {
    const r = await device.transferOut(endpoint, data.slice(i, i + CHUNK));
    if (r.status !== "ok") throw new Error(`USB transfer ${r.status}`);
  }
}

export function onDisconnect(cb: () => void): void {
  if (!hasUsb()) return;
  navigator.usb.addEventListener("disconnect", (e) => {
    if (current && (e as USBConnectionEvent).device === current.device) {
      current = null;
      cb();
    }
  });
  navigator.usb.addEventListener("connect", () => {
    if (!current) reconnect().then((p) => p && cb());
  });
}
