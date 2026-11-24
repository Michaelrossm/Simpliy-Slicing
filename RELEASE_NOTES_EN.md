# Simpliy Slicing 0.0.0-alpha.1 – Release notes

[**Deutsch 🇩🇪: original release notes**](../../releases/tag/v0.0.0-alpha.1) · **English 🇬🇧**

First public Windows alpha with a custom user interface for preparing 3D printing projects.

- Import models, place them on build plates, and assign them to processes.
- Create custom supports, including pillar, tree, fan, and gusset structures.
- Edit process/extruder settings, auto-configurations, and temperature presets.
- Inspect G-code through layer and toolpath previews, then save or upload it to supported printers.
- Use cross-section views and model marking tools.

## Installation

Download and extract `Simpliy-Slicing-0.0.0-alpha.1-Windows.zip` from the [release page](../../releases/tag/v0.0.0-alpha.1), then run `simpliy-slicing.exe`.

Slicing requires Microsoft Edge WebView2 Runtime and a **separately installed PrusaSlicer engine**. Testing primarily used PrusaSlicer **3.0.0-alpha14**. PrusaSlicer is not bundled. If necessary, configure the engine path in Simpliy.

The Windows ZIP contains getting-started instructions and license notices. The user interface in the alpha.1 release currently uses German labels. For a guided walkthrough with matching German button names, see the [English user guide](ANLEITUNG_EN.md) or the [illustrated setup](ersteinrichtung/README_EN.md).

## Safety and known limitations

**Early alpha:** Features may contain errors. Always check printer profiles, temperatures, G-code, machine limits, and support contacts before printing. Supervise first test prints. Custom height regions are still under development.

When combining Simpliy's own supports with the engine's automatic supports, use **text G-code**. Protection regions may limit automatic supports. If validation fails, Simpliy can disable automatic supports for the affected slicing run and notify the user.

## Licensing and third-party software

Simpliy's license and third-party license notices remain draft documents and require final verification. PrusaSlicer is a separately installed program governed by its own open-source license. Simpliy is **not an official Prusa Research product**.

Source archives for the identified MPL-2.0 dependencies are available as a separate release attachment: [MPL source package](../../releases/download/v0.0.0-alpha.1/Simpliy-Slicing-0.0.0-alpha.1-MPL-Sources.zip). See also [English open-source information](OPEN-SOURCE-QUELLCODE_EN.md).
