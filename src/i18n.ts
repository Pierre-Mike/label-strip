/** Interface text, French first, English second. */

export type Lang = "fr" | "en";

const fr = {
  title: "Étiquette thermique",
  tagline: "Imprimez vos bordereaux Vinted sur une imprimante thermique 80 mm.",
  drop: "Déposez le bordereau Vinted (PDF ou e-mail)",
  dropHint: "ou",
  choose: "Choisir un fichier",
  dropping: "Lecture en cours…",
  privacy:
    "Tout reste sur cet ordinateur. Le bordereau est lu par votre navigateur et n'est envoyé nulle part : pas de serveur, pas de statistiques.",
  connect: "Connecter l'imprimante",
  connected: "Imprimante : {name}",
  notConnected: "Aucune imprimante connectée",
  forget: "Oublier cette imprimante",
  print: "Imprimer",
  printAll: "Imprimer ({n})",
  printTest: "Imprimer un test",
  sending: "Envoi…",
  sent: "Envoyé à l'imprimante",
  sendFailed: "L'envoi a échoué : {msg}",
  browserPrint: "Imprimer via le navigateur",
  browserPrintAll: "Tout imprimer via le navigateur ({n})",
  pdf: "Ouvrir le PDF",
  pdfOpening: "Préparation du PDF…",
  pdfFailed: "L'impression n'a pas pu être préparée : {msg}",
  pdfAll: "Tout ouvrir en PDF",
  pdfHint: "« Imprimer via le navigateur » ouvre directement la fenêtre d'impression : choisissez l'imprimante thermique et 100 % (« Taille réelle »), pas « Ajuster à la page ».",
  noUsb:
    "Ce navigateur ne peut pas parler à une imprimante USB. Utilisez Chrome ou Edge, ou imprimez via le navigateur.",
  sample: "Exemple",
  unknownCarrier: "Transporteur inconnu",
  autoLayout: "Mise en page automatique, vérifiez l'aperçu",
  wholeLabel: "Étiquette entière, vérifiez l'aperçu",
  sampleNote: "Exemple fictif pour montrer le résultat. Déposez votre bordereau pour le remplacer.",
  remove: "Retirer",
  carrier: "Transporteur",
  length: "{mm} mm",
  verified: "{n} codes vérifiés",
  verified1: "1 code vérifié",
  realSize: "{n} code(s) trop petit(s) une fois agrandi(s) : réimprimé(s) en taille réelle en dessous.",
  working: "Préparation…",
  refused: "Pas imprimé",
  "no-code": "Aucun code-barres trouvé sur la page.",
  "crop-cuts":
    "La découpe couperait le code {format}. La mise en page de ce transporteur a changé : le modèle doit être ajusté.",
  unreadable: "Code {format} illisible, même en taille réelle. Imprimez le PDF d'origine sur une feuille A4.",
  readError: "Ce fichier n'a pas pu être lu : {msg}",
  emailEmpty: "{name} : aucun bordereau PDF dans cet e-mail.",
  ignored: "{name} : ce n'est ni un PDF ni un e-mail.",
  settings: "Réglages",
  paper: "Largeur du rouleau",
  paper80: "80 mm",
  paper58: "58 mm",
  language: "Langage de l'imprimante",
  langAuto: "Automatique (Zebra = ZPL)",
  langZpl: "ZPL (Zebra)",
  langEscpos: "ESC/POS (imprimante à tickets)",
  zplLeft: "Décalage gauche Zebra (points)",
  zplLeftHint: "Point de la tête où commence le papier. 100 pour un rouleau de 80 mm sur une ZD421.",
  plain: "Mise en page simple (étiquette entière, sans agrandir les blocs)",
  prepare: "Préparer l'imprimante Zebra",
  prepareConfirm:
    "Régler l'imprimante Zebra en thermique direct (sans ruban) et reprendre l'impression si elle est en pause ? À faire une seule fois.",
  prepared: "Réglage envoyé à l'imprimante.",
  help: "Aide",
  helpSteps: [
    "Branchez l'imprimante en USB et allumez-la.",
    "Cliquez sur « Connecter l'imprimante » et choisissez-la dans la liste. Le navigateur s'en souviendra.",
    "Déposez le bordereau reçu par e-mail : le PDF, ou l'e-mail enregistré (.eml).",
    "Vérifiez l'aperçu, puis cliquez sur « Imprimer ».",
  ],
  helpBrowsers: "Fonctionne avec Chrome ou Edge sur Mac, ChromeOS, Linux et Windows. Sur Windows, une Zebra peut demander un pilote WinUSB :",
  helpWindows: "guide Windows",
  helpCode: "Code source et modèles de transporteurs",
  langSwitch: "English",
  details: "Voir la découpe",
  offline: "Fonctionne hors ligne après la première visite.",
};

const en: typeof fr = {
  title: "Thermal label",
  tagline: "Print your Vinted shipping labels on an 80 mm thermal printer.",
  drop: "Drop the Vinted shipping label (PDF or email)",
  dropHint: "or",
  choose: "Choose a file",
  dropping: "Reading…",
  privacy:
    "Everything stays on this computer. Your browser reads the label and sends it nowhere: no server, no analytics.",
  connect: "Connect the printer",
  connected: "Printer: {name}",
  notConnected: "No printer connected",
  forget: "Forget this printer",
  print: "Print",
  printAll: "Print ({n})",
  printTest: "Print a test",
  sending: "Sending…",
  sent: "Sent to the printer",
  sendFailed: "Sending failed: {msg}",
  browserPrint: "Print with the browser",
  browserPrintAll: "Print all with the browser ({n})",
  pdf: "Open the PDF",
  pdfOpening: "Preparing the PDF…",
  pdfFailed: "Couldn't prepare the print: {msg}",
  pdfAll: "Open all as PDF",
  pdfHint: "\"Print with the browser\" opens the print dialog right away: pick the thermal printer and 100% (\"Actual size\"), not \"Fit to page\".",
  noUsb: "This browser can't talk to a USB printer. Use Chrome or Edge, or print with the browser.",
  sample: "Sample",
  unknownCarrier: "Unknown carrier",
  autoLayout: "Automatic layout, check the preview",
  wholeLabel: "Whole label, check the preview",
  sampleNote: "A made-up sample to show the result. Drop your own label to replace it.",
  remove: "Remove",
  carrier: "Carrier",
  length: "{mm} mm",
  verified: "{n} codes verified",
  verified1: "1 code verified",
  realSize: "{n} code(s) too small once enlarged: printed again at real size below.",
  working: "Preparing…",
  refused: "Not printed",
  "no-code": "No barcode found on the page.",
  "crop-cuts": "The crop would cut through the {format} code. This carrier's layout changed: its template needs adjusting.",
  unreadable: "{format} code unreadable, even at real size. Print the original PDF on A4 paper instead.",
  readError: "This file could not be read: {msg}",
  emailEmpty: "{name}: no PDF label in this email.",
  ignored: "{name}: not a PDF or an email.",
  settings: "Settings",
  paper: "Roll width",
  paper80: "80 mm",
  paper58: "58 mm",
  language: "Printer language",
  langAuto: "Automatic (Zebra = ZPL)",
  langZpl: "ZPL (Zebra)",
  langEscpos: "ESC/POS (receipt printer)",
  zplLeft: "Zebra left offset (dots)",
  zplLeftHint: "Head dot where the paper starts. 100 for an 80 mm roll on a ZD421.",
  plain: "Plain layout (whole label, blocks not enlarged)",
  prepare: "Prepare the Zebra printer",
  prepareConfirm:
    "Set the Zebra printer to direct thermal (no ribbon) and resume printing if it is paused? You only need to do this once.",
  prepared: "Setting sent to the printer.",
  help: "Help",
  helpSteps: [
    "Plug the printer in over USB and switch it on.",
    "Click \"Connect the printer\" and pick it from the list. The browser remembers it.",
    "Drop the label you received by email: the PDF, or the saved email (.eml).",
    "Check the preview, then click \"Print\".",
  ],
  helpBrowsers: "Works in Chrome or Edge on Mac, ChromeOS, Linux and Windows. On Windows a Zebra may need the WinUSB driver:",
  helpWindows: "Windows guide",
  helpCode: "Source code and carrier templates",
  langSwitch: "Français",
  details: "Show the crop",
  offline: "Works offline after the first visit.",
};

const dict = { fr, en };
export type Key = Exclude<keyof typeof fr, "helpSteps">;

let lang: Lang = "fr";
try {
  const saved = localStorage.getItem("lang");
  if (saved === "fr" || saved === "en") lang = saved;
} catch {
  /* storage blocked: keep French */
}

export const getLang = () => lang;

export function setLang(l: Lang): void {
  lang = l;
  try {
    localStorage.setItem("lang", l);
  } catch {
    /* storage blocked */
  }
}

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  return dict[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export const helpSteps = () => dict[lang].helpSteps;
