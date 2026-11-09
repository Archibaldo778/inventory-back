const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const inline = (value) => escape(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>');

// Deliberately supports only text formatting, never AI-generated HTML or links.
export const digestSummaryHtml = (summary) => {
  const blocks = []; let paragraph = []; let list = []; let ordered = false;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p style="margin:0 0 16px;line-height:1.65">${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) {
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag} style="margin:0 0 20px;padding-left:24px">${list.map((item) => `<li style="margin:0 0 10px;line-height:1.65">${inline(item)}</li>`).join('')}</${tag}>`);
    }
    list = [];
  };
  for (const raw of String(summary || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
    const bullet = /^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(line);
    if (!line || /^```/.test(line)) { flushParagraph(); flushList(); continue; }
    if (heading) {
      flushParagraph(); flushList();
      blocks.push(`<h2 style="margin:26px 0 12px;padding-bottom:8px;border-bottom:2px solid #cbb473;font-size:20px;line-height:1.35;color:#20272b">${inline(heading[2])}</h2>`);
    } else if (bullet) {
      flushParagraph(); const nextOrdered = /^\d/.test(line);
      if (list.length && nextOrdered !== ordered) flushList();
      ordered = nextOrdered; list.push(bullet[1]);
    } else if (list.length && /^\s+/.test(raw)) {
      list[list.length - 1] += ` ${line}`;
    } else {
      flushList(); paragraph.push(line);
    }
  }
  flushParagraph(); flushList();
  return blocks.join('\n');
};

export const eventDigestEmailHtml = (event, summary) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#eef1f3;color:#252b2f;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f3"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="700" cellpadding="0" cellspacing="0" style="width:100%;max-width:700px;background:#ffffff;border:1px solid #dce1e4">
<tr><td style="background:#19242a;border-top:6px solid #cbb473;padding:28px 24px;color:#ffffff"><p style="margin:0 0 12px;color:#dfca90;font-size:12px;font-weight:bold;letter-spacing:2px">OCC STAFFING &amp; SERVICE</p><h1 style="margin:0 0 14px;font-size:30px;line-height:1.2">Event summary</h1><p style="margin:0;font-size:18px;line-height:1.5">${escape(event.title)}</p><p style="margin:6px 0 0;color:#d5dadd;font-size:14px">${escape(event.date)}</p></td></tr>
<tr><td style="padding:6px 24px 24px;font-size:15px;line-height:1.65">${digestSummaryHtml(summary)}</td></tr>
<tr><td style="padding:18px 24px;border-top:1px solid #e2e6e8;color:#68737b;font-size:12px;line-height:1.5">AI summary based on all required captain and kitchen reports.</td></tr>
</table></td></tr></table></body></html>`;
