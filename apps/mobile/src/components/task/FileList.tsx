import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { fileName, isImage, signedUrls } from '@/lib/files';

import { colors } from '../theme';

export function FileList({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join('|');

  useEffect(() => {
    if (!key) return;
    signedUrls(key.split('|'))
      .then(setUrls)
      .catch(() => setUrls({}));
  }, [key]);

  if (paths.length === 0) return null;

  return (
    <View style={styles.list}>
      {paths.map((path) => {
        const url = urls[path];
        return (
          <Pressable
            key={path}
            disabled={!url}
            onPress={() => url && WebBrowser.openBrowserAsync(url)}
            style={styles.item}>
            {url && isImage(path) ? (
              <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.placeholder]}>
                <Text style={styles.ext}>{path.split('.').pop()?.toUpperCase()}</Text>
              </View>
            )}
            <Text style={styles.name} numberOfLines={1}>
              {fileName(path)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { width: 96, gap: 4 },
  thumb: { width: 96, height: 96, borderRadius: 10, backgroundColor: colors.border },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  ext: { fontSize: 13, fontWeight: '700', color: colors.muted },
  name: { fontSize: 12, color: colors.muted },
});
