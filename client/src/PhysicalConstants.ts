import {Phaser} from './util/alias/phaser';

class PhysicalConstants {
  public static readonly WORLD_SIZE = 40000;

  public static readonly COMMENT_CHUNKS_COUNT = 50;
  public static readonly UPDATING_COMMENT_CHUNKS_COUNT = 20;

  public static readonly BACKGROUND_SAMPLING_RADIUS = 3100;
  public static readonly ENTITY_TRACKER_UPDATE_RADIUS =
      PhysicalConstants.WORLD_SIZE / PhysicalConstants.COMMENT_CHUNKS_COUNT * (4 / 7);
  private static readonly MAXIMUM_COMMENT_WIDTH = 100; // TODO
  // A comment has anchor in the center.
  public static readonly MAXIMUM_COMMENT_WIDTH_OUTSIDE_CHUNK =
      PhysicalConstants.MAXIMUM_COMMENT_WIDTH / 2;

  public static readonly PLAYER_MOVE_DISTANCE_PER_SECOND = 216;

  public static readonly COMMENT_BLINK_DURATION_MS = 150;

  public static readonly BACKGROUND_COLORS_COUNT_TO_REACH_MAX_LIGHTNESS = 300;
  public static readonly BACKGROUND_COLORS_COUNT_TO_REACH_MAX_SATURATION = 15;
  public static readonly BACKGROUND_TRANSITION_DURATION_MS = 3 * Phaser.Timer.SECOND;

  public static readonly CHEST_SPAWN_INTERVAL = 120;
  public static readonly HASTY_BOOST_RATIO = 1.4;

  public static getRenderRadius(gameWidth: number, gameHeight: number): number {
    let longerSide = Math.max(gameWidth, gameHeight);
    let bufferingDistance = this.PLAYER_MOVE_DISTANCE_PER_SECOND * 2;
    let renderRadius = longerSide + this.MAXIMUM_COMMENT_WIDTH_OUTSIDE_CHUNK + bufferingDistance;
    return Math.ceil(renderRadius * 1.05);
  }
}

export default PhysicalConstants;
