import { Asset } from 'expo-asset';

import { theme } from '../theme';

const PATTERN = require('../../../assets/chat/pattern.png');

// В браузере повтор картинки у ImageBackground заполняет не всё окно — рисуем узор фоном CSS.
export function PatternLayer({ light }: { light: boolean }) {
  const uri = Asset.fromModule(PATTERN).uri;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage: `url(${uri})`,
        backgroundRepeat: 'repeat',
        backgroundSize: '240px 240px',
        filter: light ? 'invert(1)' : undefined,
        opacity: light ? theme.patternOpacity : 1,
      }}
    />
  );
}
