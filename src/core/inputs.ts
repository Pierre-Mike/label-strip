/** Turn dropped files (PDFs and saved emails) into a list of label PDFs, each once. */
import PostalMime from "postal-mime";

export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

export interface Collected {
  pdfs: InputFile[];
  /** Emails that held no PDF. */
  empty: string[];
  /** Files that are neither a PDF nor an email. */
  ignored: string[];
}

const isPdf = (name: string, bytes: Uint8Array) =>
  name.toLowerCase().endsWith(".pdf") || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);

const baseName = (name: string) => name.split(/[\\/]/).pop() || name;

/** PDF attachments of an email, nested forwarded messages included. */
export async function pdfsInEmail(bytes: Uint8Array): Promise<InputFile[]> {
  const out: InputFile[] = [];
  const walk = (mail: { attachments?: Array<{ filename: string | null; mimeType?: string; content: unknown }> }) => {
    for (const a of mail.attachments ?? []) {
      const content = a.content;
      const data =
        content instanceof ArrayBuffer ? new Uint8Array(content) : content instanceof Uint8Array ? content : null;
      if (!data) continue;
      const name = a.filename ?? "";
      if (name.toLowerCase().endsWith(".pdf") || a.mimeType === "application/pdf") {
        out.push({ name: baseName(name || "label.pdf"), bytes: data });
      }
    }
  };
  const mail = await PostalMime.parse(bytes, { rfc822Attachments: true });
  walk(mail as never);
  // Forwarded mails attached as message/rfc822: open them too.
  for (const a of (mail.attachments ?? []) as Array<{ mimeType?: string; content: unknown }>) {
    if (a.mimeType === "message/rfc822" && a.content instanceof ArrayBuffer) {
      for (const f of await pdfsInEmail(new Uint8Array(a.content))) out.push(f);
    }
  }
  return out;
}

/** Same rule as the script: a label seen twice (same file name) is kept once. */
export async function collect(files: InputFile[]): Promise<Collected> {
  const seen = new Set<string>();
  const res: Collected = { pdfs: [], empty: [], ignored: [] };
  const add = (f: InputFile) => {
    if (seen.has(f.name)) return;
    seen.add(f.name);
    res.pdfs.push(f);
  };
  for (const f of files) {
    const email = f.name.toLowerCase().endsWith(".eml") || (!isPdf(f.name, f.bytes) && looksLikeEmail(f.bytes));
    if (email) {
      const pdfs = await pdfsInEmail(f.bytes);
      if (!pdfs.length) res.empty.push(f.name);
      pdfs.forEach(add);
    } else if (isPdf(f.name, f.bytes)) {
      add({ name: baseName(f.name), bytes: f.bytes });
    } else {
      res.ignored.push(f.name);
    }
  }
  return res;
}

function looksLikeEmail(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 2048)).toLowerCase();
  return /^(from|received|return-path|mime-version|date|subject|message-id|delivered-to):/m.test(head) && head.includes("content-type");
}
