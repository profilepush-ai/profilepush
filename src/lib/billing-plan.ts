export const TIERS = [25, 50, 100, 200, 300, 500];
export const INR_PER_USD = 100;

export function fmtINR(usd: number) {
  return `₹${(usd * INR_PER_USD).toLocaleString('en-IN')}`;
}

export function loadRazorpay(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = (window as Window & { Razorpay?: unknown }).Razorpay;
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay'));
    document.head.appendChild(script);
  });
}
