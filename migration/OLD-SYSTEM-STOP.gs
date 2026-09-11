/**
 * PURANE GROW SYSTEM KO BAND KARO — "naye system pe jao" page dikhao.
 *
 * Kaise lagao:
 *  1. Purani GROW sheet -> Extensions -> Apps Script
 *  2. `Code.gs` me apna current `function doGet(e) { ... }` dhundo.
 *  3. Us line ke aage `_` laga do -> `function doGet_OLD(e) { ... }` (delete mat karo — wapasi ke liye).
 *  4. Neeche wala poora code paste karo (naya doGet + doGetOldApp).
 *  5. Save (💾).
 *  6. Deploy -> Manage deployments -> (pencil ✏️) -> Version: "New version" -> Deploy.
 *  7. Purana link kholke check karo — ab "System band" page aana chahiye.
 *
 * WAPAS CHALU karna ho (agar naye system me kuch dikkat aaye):
 *  - Is naye `doGet` ko `doGet_STOP` naam de do, aur `doGet_OLD` ko wapas `doGet` bana do.
 *  - Dobara Deploy -> Manage deployments -> New version -> Deploy.
 */

var NEW_APP_URL = 'https://paris-crm.web.app';

function doGet(e) {
  // ?admin=grow2026  ->  emergency ke liye purana app khol lo (link kisi ko mat do)
  if (e && e.parameter && e.parameter.admin === 'grow2026' && typeof doGet_OLD === 'function') {
    return doGet_OLD(e);
  }

  var html =
    '<!DOCTYPE html><html lang="hi"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Paris CRM — System Moved</title>' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#001f3f;' +
    'color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}' +
    '.card{max-width:440px;width:100%;background:#fff;color:#1a2b45;border-radius:18px;' +
    'padding:32px 26px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4)}' +
    '.ico{font-size:46px;margin-bottom:12px}' +
    'h1{font-size:20px;margin-bottom:8px;color:#001f3f}' +
    'p{font-size:14px;line-height:1.6;color:#4a5a72;margin-bottom:8px}' +
    '.btn{display:block;margin-top:20px;background:#001f3f;color:#fff;text-decoration:none;' +
    'padding:15px;border-radius:12px;font-weight:700;font-size:15px}' +
    '.note{margin-top:16px;font-size:12px;color:#8a97ab}' +
    '.pw{background:#f0f3f8;border-radius:10px;padding:10px;margin-top:14px;font-size:13px;color:#1a2b45}' +
    '.pw b{font-family:monospace;font-size:15px}' +
    '</style></head><body><div class="card">' +
    '<div class="ico">🚀</div>' +
    '<h1>Ye system ab band hai</h1>' +
    '<p>Paris CRM naye system pe shift ho gaya hai. Purana data sab naye system me aa chuka hai.</p>' +
    '<p><b>Ab saara kaam naye link pe hoga.</b></p>' +
    '<div class="pw">Login: apni <b>purani email</b> + password <b>Paris@2026</b><br>' +
    '(pehli baar login pe apna naya password set karo)</div>' +
    '<a class="btn" href="' + NEW_APP_URL + '" target="_blank" rel="noopener">Naya CRM kholo →</a>' +
    '<div class="note">' + NEW_APP_URL + '<br>Isko phone me bookmark / home-screen pe add kar lo.</div>' +
    '</div></body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('Paris CRM — System Moved')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}
