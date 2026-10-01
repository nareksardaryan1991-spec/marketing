import * as Print from 'expo-print';

// Системное окно печати: там же «Сохранить как PDF» или отправить файл.
export async function printReceipt(html: string): Promise<void> {
  await Print.printAsync({ html });
}
