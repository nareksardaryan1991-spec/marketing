// В браузере печатаем только квитанцию (а не всю страницу приложения):
// в окне печати можно выбрать «Сохранить как PDF».
export async function printReceipt(html: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    throw new Error('print is not available');
  }
  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 1000);
}
