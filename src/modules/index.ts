import type { GameModule } from '@core/modules/GameModule';
import { playerModule } from './player';
import { cameraModule } from './camera';
import { worldModule } from './world';
import { statusModule } from './status';
import { skillsModule } from './skills';
import { combatModule } from './combat';
import { charactersModule } from './characters';
import { enemiesModule } from './enemies';
import { economyModule } from './economy';
import { progressionModule } from './progression';
import { lightconesModule } from './lightcones';
import { relicsModule } from './relics';
import { inventoryModule } from './inventory';
import { questModule } from './quest';
import { dialogueModule } from './dialogue';
import { mapModule } from './map';
import { uiModule } from './ui/module';
import { gachaModule } from './gacha';
import { eventsModule } from './events';
import { roguelikeModule } from './roguelike';
import { endgameModule } from './endgame';
import { achievementsModule } from './achievements';
import { dailyModule } from './daily';
import { saveModule } from './save';
import { settingsModule } from './settings';
import { audioModule } from './audio';
import { vfxModule } from './vfx/module';
import { socialModule } from './social';

/**
 * Every gameplay module, in roadmap order. The ModuleManager sorts them topologically by
 * `dependsOn`, so this order is documentation, not a requirement.
 */
export const ALL_MODULES: readonly GameModule[] = [
  uiModule,
  playerModule,
  cameraModule,
  worldModule,
  statusModule,
  skillsModule,
  combatModule,
  charactersModule,
  enemiesModule,
  economyModule,
  progressionModule,
  lightconesModule,
  relicsModule,
  inventoryModule,
  questModule,
  dialogueModule,
  mapModule,
  gachaModule,
  eventsModule,
  roguelikeModule,
  endgameModule,
  achievementsModule,
  dailyModule,
  saveModule,
  settingsModule,
  audioModule,
  vfxModule,
  socialModule,
];
