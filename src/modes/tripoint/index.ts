import type { ModeModule } from '../types';
import { h } from '../../core/ui';

const mode: ModeModule = {
  mount(ctx) {
    ctx.root.append(h('p', { class: 'muted' }, 'Coming soon'));
  },
  howTo: () => h('p', {}, 'Coming soon'),
};
export default mode;
