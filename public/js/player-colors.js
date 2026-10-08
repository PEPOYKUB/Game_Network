// FFA identity colors: names are used as the in-game character display names.
export const PLAYER_COLORS = Object.freeze([
  Object.freeze({ id: 'ruby', name: 'ทับทิม', nameEn: 'RUBY', hex: '#d9425d' }),
  Object.freeze({ id: 'sapphire', name: 'ไพลิน', nameEn: 'SAPPHIRE', hex: '#3478d4' }),
  Object.freeze({ id: 'emerald', name: 'มรกต', nameEn: 'EMERALD', hex: '#238b62' }),
  Object.freeze({ id: 'amber', name: 'อำพัน', nameEn: 'AMBER', hex: '#d38b16' }),
  Object.freeze({ id: 'violet', name: 'ไวโอเล็ต', nameEn: 'VIOLET', hex: '#8652bf' }),
]);

export const playerColor = (id) => PLAYER_COLORS.find((color) => color.id === id) || null;
