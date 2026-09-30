import { File } from 'expo-file-system';

export async function readAsset(asset: { uri: string }): Promise<ArrayBuffer> {
  return await new File(asset.uri).arrayBuffer();
}
