export const runtime = 'edge'

export async function GET(request) {
  const url = new URL(request.url)
  const { searchParams } = url

  // SECURITY (#4): public GET whose params are inlined into the page below.
  // Strictly validate the Airwallex identifiers (base64url/JWT-safe charset)
  // and reject anything else so nothing can break out of the JS string
  // context. Values are still JSON.stringify'd at the injection site as
  // defense-in-depth.
  const ID_RE = /^[A-Za-z0-9._-]{1,1024}$/
  const intentId = searchParams.get('intentId') || ''
  const clientSecret = searchParams.get('clientSecret') || ''
  const amount = searchParams.get('amount')
  if (!ID_RE.test(intentId) || !ID_RE.test(clientSecret)) {
    return new Response(
      '<!DOCTYPE html><meta charset="utf-8"><body style="font-family:-apple-system,sans-serif;background:#0F0B2E;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Invalid checkout parameters.</p></body>',
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    )
  }
  // SECURITY (#4 open-redirect): do NOT trust client-supplied result URLs --
  // Airwallex redirects to these after payment, so an attacker-controlled
  // value is an open-redirect / phishing vector. Reconstruct from THIS
  // request's own origin; they always point at our own payment-result bridge.
  const origin = url.origin
  const successUrl = `${origin}/api/payment-result?status=success`
  const failUrl = `${origin}/api/payment-result?status=fail`
  const cancelUrl = `${origin}/api/payment-result?status=cancel`

  // 这个页面会短暂显示一个加载动画，然后迅速被 Airwallex SDK 接管并重定向
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Secure Checkout</title>
  <script src="https://static.airwallex.com/components/sdk/v1/index.js"></script>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0F0B2E; color: white; }
    .loader { border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #A855F7; border-radius: 50%; width: 32px; height: 32px; animation: spin 1s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div style="text-align: center;">
    <div class="loader"></div>
    <p style="color: rgba(255,255,255,0.6); font-size: 14px;">Connecting to secure payment...</p>
  </div>

  <script>
    // 初始化 SDK 并立即发起跳转
    AirwallexComponentsSDK.init({
      env: 'prod',
      enabledElements: ['payments']
    }).then(function(res) {
      res.payments.redirectToCheckout({
        intent_id: ${JSON.stringify(intentId)},
        client_secret: ${JSON.stringify(clientSecret)},
        currency: 'USD',
        country_code: 'HK',
        successUrl: ${JSON.stringify(successUrl)},
        failUrl: ${JSON.stringify(failUrl)},
        cancelUrl: ${JSON.stringify(cancelUrl)},
        appearance: { 
          mode: 'light',
          variables: { colorBrand: '#A855F7' }
        }
      });
    }).catch(function(err) {
      document.body.innerHTML = '<div style="color: #ef4444; padding: 20px;">Failed to load secure checkout. Please close and try again.</div>';
    });
  </script>
</body>
</html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}