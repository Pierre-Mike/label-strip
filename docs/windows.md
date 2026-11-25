# Windows: let Chrome reach a Zebra printer over USB

Chrome can only talk to a USB device that uses the generic WinUSB driver. When Windows has installed the Zebra driver, Chrome lists the printer but can't open it, and the page shows an error after you pick it.

The fix is to swap the driver with Zadig, a free tool. This takes about five minutes and you only do it once per computer.

> After the swap, Windows programs that print through the Zebra driver (Word, the Zebra Setup Utilities) can't use this printer any more. To go back, see "Undo" at the end.

## Steps

1. Plug in the printer and switch it on.
2. Download Zadig from its official site, zadig.akeo.ie, and run it. Windows asks for permission: accept.
3. In the **Options** menu, tick **List All Devices**.
4. In the drop-down list, pick the Zebra printer (for example "ZTC ZD421-203dpi ZPL"). Check that the **USB ID** starts with `0A5F`. If several entries show, pick the one with `Interface 0` or the one named after the printer.
5. In the box to the right of the green arrow, pick **WinUSB**.
6. Click **Replace Driver** (or **Install Driver**) and wait for "The driver was installed successfully".
7. Unplug the printer and plug it back in.
8. In Chrome, open the page, click **Connecter l'imprimante** and pick the printer.

<!-- Screenshots of steps 3 to 6 go in docs/img/ once taken on a Windows machine with a Zebra attached. -->

## Receipt printers

Most USB receipt printers work the same way: pick the printer in Zadig and install WinUSB. Some come with their own driver that Chrome can't reach either.

## Undo

1. Open **Device Manager** (right-click the Start button).
2. Find the printer under **Universal Serial Bus devices**, right-click it and pick **Uninstall device**. Tick **Delete the driver software for this device** if Windows offers it.
3. Unplug the printer, plug it back in, and reinstall the Zebra driver from zebra.com.

## Mac, ChromeOS and Linux

Nothing to install on Mac or ChromeOS. On Linux, Chrome may need a udev rule that lets your user open the printer:

```
# /etc/udev/rules.d/60-zebra.rules
SUBSYSTEM=="usb", ATTR{idVendor}=="0a5f", MODE="0666"
```

Then run `sudo udevadm control --reload-rules` and plug the printer in again. If the kernel's `usblp` driver has claimed the printer, Chrome can't open it until you unload it with `sudo modprobe -r usblp`.
