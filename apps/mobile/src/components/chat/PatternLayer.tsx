import { ImageBackground, StyleSheet } from 'react-native';

const PATTERN = require('../../../assets/chat/pattern.png');

// Узор поверх цвета фона. light — белый узор для тёмного фона.
export function PatternLayer({ light }: { light: boolean }) {
  return (
    <ImageBackground
      source={PATTERN}
      resizeMode="repeat"
      style={StyleSheet.absoluteFill}
      imageStyle={light ? { tintColor: '#FFFFFF', opacity: 0.6 } : undefined}
    />
  );
}
