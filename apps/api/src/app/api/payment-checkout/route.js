export const runtime = 'edge'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const intentId = searchParams.get('intentId')
  const clientSecret = searchParams.get('clientSecret')
  const amount = searchParams.get('amount')
  const successUrl = searchParams.get('successUrl')
  const failUrl = searchParams.get('failUrl')
  const cancelUrl = searchParams.get('cancelUrl')

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
        intent_id: '${intentId}',
        client_secret: '${clientSecret}',
        currency: 'USD',
        country_code: 'HK',
        successUrl: '${successUrl}',
        failUrl: '${failUrl}',
        cancelUrl: '${cancelUrl}',
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