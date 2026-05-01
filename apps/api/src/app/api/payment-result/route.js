export const runtime = 'edge'

/**
 * Payment Result Bridge Page - 优化版
 * * 任务：
 * 1. 接收 Airwallex 跳转回来的状态（success, fail, cancel）
 * 2. 写入 localStorage 供 App 恢复焦点后读取
 * 3. 自动触发协议唤醒并退回到手机 App 环境
 */

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') || 'unknown'
  const paymentIntentId = searchParams.get('payment_intent_id') || ''

  const isSuccess = status === 'success'
  const isCancel = status === 'cancel'
  
  // 根据状态动态配置 UI 表现
  const bgColor = isSuccess ? '#f0fdf4' : (isCancel ? '#f8fafc' : '#fef2f2')
  const icon = isSuccess ? '✅' : (isCancel ? '↩️' : '❌')
  const title = isSuccess ? 'Payment Successful!' : (isCancel ? 'Payment Cancelled' : 'Payment Failed')
  const titleColor = isSuccess ? '#166534' : (isCancel ? '#475569' : '#991b1b')
  const message = isSuccess 
    ? 'Your payment is confirmed. Returning to NovaMe...' 
    : (isCancel 
        ? 'You cancelled the payment. Returning to NovaMe...' 
        : 'Something went wrong. Returning to NovaMe...')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${bgColor};
      padding: 24px;
      transition: background 0.3s ease;
    }
    .container { text-align: center; max-width: 400px; }
    .icon { font-size: 64px; margin-bottom: 16px; display: none; }
    h1 { font-size: 24px; font-weight: 700; color: ${titleColor}; margin-bottom: 8px; }
    p { font-size: 14px; color: #6b7280; margin-bottom: 24px; }
    .btn {
      display: inline-block; padding: 14px 32px; border-radius: 16px; font-size: 16px; font-weight: 700;
      color: white; background: ${isSuccess ? 'linear-gradient(135deg, #A855F7, #7C3AED)' : '#6b7280'};
      border: none; cursor: pointer; text-decoration: none; width: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .spinner {
      width: 32px; height: 32px; border: 3px solid #e5e7eb;
      border-top-color: ${isSuccess ? '#22c55e' : (isCancel ? '#94a3b8' : '#ef4444')}; 
      border-radius: 50%;
      animation: spin 0.8s linear infinite; margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .sub { font-size: 12px; color: #9ca3af; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <button class="btn" id="returnBtn">Return to App</button>
    <p class="sub">If the app doesn't open automatically, tap the button above or swipe back.</p>
  </div>

  <script>
    // 准备支付结果数据
    var result = {
      status: '${status}',
      paymentIntentId: '${paymentIntentId}',
      timestamp: Date.now()
    };

    // 1. 尝试在 localStorage 中保存结果（虽然在 WebView 中可能由于域限制无法跨域读取，但作为保底逻辑保留）
    try {
      localStorage.setItem('airwallex_payment_result', JSON.stringify(result));
    } catch(e) {}

    function returnToApp() {
      // 2. 尝试使用 iOS Capacitor 的专用协议返回
      window.location.href = 'capacitor://localhost';
      
      // 3. 尝试使用 Android Capacitor 的协议
      setTimeout(function() {
        window.location.href = 'https://localhost';
      }, 300);
      
      // 4. 终极防线：如果上述皆无效，强行后退历史记录以尝试退出 WebView 环境
      setTimeout(function() {
        window.history.go(-3);
      }, 800);
    }

    // 模拟处理时间后自动返回
    setTimeout(function() {
      document.querySelector('.spinner').style.display = 'none';
      document.querySelector('.icon').style.display = 'block';
      returnToApp();
    }, 1500);

    // 手动点击按钮返回
    document.getElementById('returnBtn').addEventListener('click', function() {
      returnToApp();
    });
  </script>
</body>
</html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}