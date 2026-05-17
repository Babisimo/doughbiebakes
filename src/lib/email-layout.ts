import { site } from "./site.ts";

export const INK = "#283618";
export const INK_700 = "#36441f";
export const INK_500 = "#6c7150";
export const BONE = "#fefae0";
export const PAPER = "#fffdf2";
export const ACID = "#a55d1f";
export const SAGE = "#ccd5ae";
export const OCHRE = "#dda15e";
export const FLAME = "#606c38";

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "'Cooper Black',Georgia,'Times New Roman',serif";

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

export function emailButton(
  href: string,
  label: string,
  variant: "primary" | "secondary" = "primary",
): string {
  const bg = variant === "primary" ? ACID : PAPER;
  const fg = variant === "primary" ? PAPER : INK;
  return (
    `<a href="${escapeHtml(href)}" style="display:inline-block;` +
    `padding:12px 22px;margin:8px 8px 0 0;background:${bg};color:${fg};` +
    `border:2px solid ${INK};border-radius:9999px;font-family:${SANS};` +
    `font-size:14px;font-weight:700;text-decoration:none;">` +
    `${escapeHtml(label)}</a>`
  );
}

export function lineItemsTable(
  rows: { label: string; amount: string }[],
  totalRow?: { label: string; amount: string },
): string {
  const cell = `padding:7px 0;border-bottom:1px solid rgba(40,54,24,0.12);font-size:15px;color:${INK_700};`;
  const body = rows
    .map(
      (r) =>
        `<tr><td style="${cell}">${escapeHtml(r.label)}</td>` +
        `<td style="${cell}text-align:right;white-space:nowrap;">${r.amount}</td></tr>`,
    )
    .join("");
  const tcell = `padding:12px 0 0;font-size:16px;font-weight:700;color:${INK};`;
  const total = totalRow
    ? `<tr><td style="${tcell}">${escapeHtml(totalRow.label)}</td>` +
      `<td style="${tcell}text-align:right;">${totalRow.amount}</td></tr>`
    : "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `border="0" style="width:100%;border-collapse:collapse;margin:6px 0;">` +
    `${body}${total}</table>`
  );
}

export function infoCard(
  innerHtml: string,
  tone: "ochre" | "sage" = "ochre",
): string {
  const bg = tone === "sage" ? "#eef3df" : "#fbedd6";
  const border = tone === "sage" ? SAGE : OCHRE;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `border="0" style="width:100%;border-collapse:separate;margin:14px 0;">` +
    `<tr><td style="padding:14px 18px;background:${bg};border:1px solid ${border};` +
    `border-radius:12px;font-family:${SANS};font-size:14px;line-height:1.5;` +
    `color:${INK_700};">${innerHtml}</td></tr></table>`
  );
}

export function renderEmail(opts: {
  preheader: string;
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  footerNote?: string;
}): string {
  const year = new Date().getFullYear();
  return (
    `<!doctype html><html lang="en"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(site.name)}</title></head>` +
    `<body style="margin:0;padding:0;background:${BONE};-webkit-text-size-adjust:100%;">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">` +
    `${escapeHtml(opts.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${BONE};padding:32px 16px;"><tr><td align="center">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="max-width:560px;background:${PAPER};border:2px solid ${INK};` +
    `border-radius:20px;box-shadow:8px 8px 0 0 rgba(40,54,24,0.18);overflow:hidden;">` +
    `<tr><td style="padding:22px 28px;border-bottom:2px solid ${INK};` +
    `font-family:${SERIF};font-size:24px;color:${INK};">🍞 ${escapeHtml(site.name)}</td></tr>` +
    `<tr><td style="padding:26px 28px 4px;font-family:${SANS};">` +
    `<p style="margin:0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;` +
    `color:${INK_500};">${escapeHtml(opts.eyebrow)}</p>` +
    `<h1 style="margin:6px 0 0;font-family:${SERIF};font-size:26px;line-height:1.2;` +
    `color:${INK};">${escapeHtml(opts.heading)}</h1></td></tr>` +
    `<tr><td style="padding:10px 28px 24px;font-family:${SANS};font-size:15px;` +
    `line-height:1.55;color:${INK_700};">${opts.bodyHtml}</td></tr>` +
    `<tr><td style="padding:16px 28px 26px;border-top:1px solid rgba(40,54,24,0.15);` +
    `font-family:${SANS};font-size:12px;color:${INK_500};">` +
    `${opts.footerNote ? escapeHtml(opts.footerNote) + "<br/>" : ""}` +
    `${escapeHtml(site.name)} · ${escapeHtml(site.city)} · ` +
    `${escapeHtml(site.cottageFood.madeIn)}. ${escapeHtml(site.cottageFood.permitNumber)}.` +
    `<br/>Questions? Just reply to this email.</td></tr></table>` +
    `<p style="margin:16px 0 0;font-family:${SANS};font-size:11px;color:${INK_500};">` +
    `© ${year} ${escapeHtml(site.name)} · ${escapeHtml(site.city)}</p>` +
    `</td></tr></table></body></html>`
  );
}
