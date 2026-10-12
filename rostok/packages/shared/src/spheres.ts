/** Шесть сфер жизни. Вид дерева у сферы неизменен. Конфигурируется здесь и в таблице spheres. */
export type SphereId = 'relationships' | 'savings' | 'work' | 'creativity' | 'health' | 'study';
export type SpeciesId = 'sakura' | 'golden' | 'oak' | 'blossom' | 'lush' | 'willow';

export interface SphereDef {
  id: SphereId;
  name: string;
  species: SpeciesId;
  speciesName: string;
  /** Мягкий цвет сферы для чипов и баров */
  tint: string;
  /** Насыщенный цвет для иконки/текста (контраст AA на белом) */
  ink: string;
  sort: number;
}

export const SPHERES: readonly SphereDef[] = [
  { id: 'relationships', name: 'Отношения', species: 'sakura', speciesName: 'Сакура', tint: '#FBE3EC', ink: '#B5487A', sort: 1 },
  { id: 'savings', name: 'Накопления', species: 'golden', speciesName: 'Золотое дерево', tint: '#FBF0D6', ink: '#8A6512', sort: 2 },
  { id: 'work', name: 'Работа', species: 'oak', speciesName: 'Дуб', tint: '#E4F1E6', ink: '#276B48', sort: 3 },
  { id: 'creativity', name: 'Творчество', species: 'blossom', speciesName: 'Сиреневое дерево', tint: '#F1E6F7', ink: '#7C4A9E', sort: 4 },
  { id: 'health', name: 'Здоровье', species: 'lush', speciesName: 'Пышное дерево', tint: '#E3F4E3', ink: '#2F7A3A', sort: 5 },
  { id: 'study', name: 'Учёба', species: 'willow', speciesName: 'Дерево знаний', tint: '#E0F2F1', ink: '#23706B', sort: 6 },
] as const;

export const SPHERE_IDS = SPHERES.map((s) => s.id) as SphereId[];
export const sphereById = (id: string): SphereDef | undefined => SPHERES.find((s) => s.id === id);
export const isSphereId = (id: unknown): id is SphereId => typeof id === 'string' && SPHERE_IDS.includes(id as SphereId);
