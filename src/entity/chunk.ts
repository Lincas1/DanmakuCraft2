import {Entity, EntityManager, Region} from './entity';
import {PhysicalConstants} from '../Universe';

/**
 * Implements {@link EntityManager} with arrays of {@link Chunk}s.
 */
export class ChunkEntityManager<E extends Entity = Entity> implements EntityManager<E> {
  private renderChunksCount: number;
  private chunkSize: number;
  private chunksCount: number;
  private chunks: Array<Array<Chunk<E>>>;

  /**
   * @param chunksCount Number of chunks in a certain dimension.
   * @param renderDistance Minimum distance in world coordinate to render around a point.
   */
  constructor(chunksCount: number, renderDistance: number) {
    // TODO support for updating render distance
    this.chunksCount = Math.floor(chunksCount);
    this.chunkSize = PhysicalConstants.WORLD_SIZE / this.chunksCount;
    this.renderChunksCount = Math.ceil(renderDistance / this.chunkSize);

    if (this.chunksCount <= 0) {
      throw new Error('Invalid chunks count');
    }

    if (this.renderChunksCount <= 0) {
      throw new Error('Invalid render distance');
    }
    if ((this.renderChunksCount * 2 + 1) * this.chunkSize > PhysicalConstants.WORLD_SIZE) {
      throw new Error('Render distance too large');
    }

    this.chunks = ChunkEntityManager.makeChunks(this.chunksCount, this.chunkSize);
  }

  private static makeChunks<E extends Entity>(
      chunksCount: number, chunkSize: number): Array<Array<Chunk<E>>> {
    let chunks = [];
    let coordinate = new Phaser.Point();

    for (let y = 0; y < chunksCount; y++) {
      coordinate.y = y * chunkSize;
      let chunksRow = [];

      for (let x = 0; x < chunksCount; x++) {
        coordinate.x = x * chunkSize;
        chunksRow.push(new Chunk<E>(coordinate));
      }

      chunks.push(chunksRow);
    }

    return chunks;
  }

  loadBatch(entities: E[]): void {
    for (let entity of entities) {
      this.load(entity);
    }
  }

  load(entity: E): void {
    let coordinate = this.toChunkCoordinate(entity.getCoordinate());
    let chunk = this.getChunk(coordinate.x, coordinate.y);
    chunk.addEntity(entity);
  }

  listRenderableRegions(worldCoordinate: Phaser.Point): Array<Chunk<E>> {
    let coordinate = this.toChunkCoordinate(worldCoordinate);
    let bound = this.inflate(coordinate, this.renderChunksCount);
    return this.listChunksInBound(bound.left, bound.right, bound.top, bound.bottom);
  }

  leftOuterJoinRenderableRegions(
      worldCoordinate: Phaser.Point, otherCoordinate: Phaser.Point): Array<Chunk<E>> {
    let leftCoordinate = this.toChunkCoordinate(worldCoordinate);
    let rightCoordinate = this.toChunkCoordinate(otherCoordinate);
    if (leftCoordinate.equals(rightCoordinate)) {
      return [];
    }

    // Collect all chunks in either vertical or horizontal area.
    // Case 1:
    // V V H H
    // V V H H
    // V V H H
    // V V o o o o
    //     o o o o
    //     o o o o
    //     o o o o
    //
    // Case 2:
    // o o o o
    // o o o o
    // o o o o
    // o o o o V V
    //     H H V V
    //     H H V V
    //     H H V V
    let chunks: Array<Chunk<E>> = [];

    // Collect chunks in vertical area.
    let leftBound = this.inflate(leftCoordinate, this.renderChunksCount);
    let rightBound = this.inflate(rightCoordinate, this.renderChunksCount);
    if (leftCoordinate.x !== rightCoordinate.x) {
      let left;
      let right;
      if (leftCoordinate.x < rightCoordinate.x) {
        left = leftBound.left;
        right = rightBound.left - 1;
      } else {
        left = rightBound.right + 1;
        right = leftBound.right;
      }

      let top = leftBound.top;
      let bottom = leftBound.bottom;
      this.pushChunksInBound(left, right, top, bottom, chunks);
    }

    // Collect chunks in horizontal area.
    if (leftCoordinate.y !== rightCoordinate.y) {
      let left;
      let right;
      if (leftCoordinate.x < rightCoordinate.x) {
        left = rightBound.left;
        right = leftBound.right;
      } else {
        left = leftBound.left;
        right = rightBound.right;
      }

      let top;
      let bottom;
      if (leftCoordinate.y < rightCoordinate.y) {
        top = leftBound.top;
        bottom = rightBound.top - 1;
      } else {
        top = rightBound.bottom + 1;
        bottom = leftBound.bottom;
      }

      this.pushChunksInBound(left, right, top, bottom, chunks);
    }

    return chunks;
  }

  forEach(f: (value: Chunk<E>, index: number) => void, thisArg?: any) {
    this.chunks.forEach((chunkRow, chunkRowIndex) => {
      chunkRow.forEach((chunk, chunkIndex) => {
        let index = chunkRowIndex * this.chunksCount + chunkIndex;
        f.call(thisArg, chunk, index);
      });
    });
  }

  scan(f: (chunks: Array<Chunk<E>>) => void, radius: number): void {
    let size = Math.ceil(radius * 2 / this.chunkSize);
    if (!(size > 0 && size <= this.chunksCount)) {
      throw new Error(`Radius '${radius}' is invalid`);
    }

    let inflation = size - 1;
    let end = this.chunksCount - inflation;
    for (let y = 0; y < end; y++) {
      for (let x = 0; x < end; x++) {
        let neighbors = this.listChunksInBound(x, x + inflation, y, y + inflation);
        f(neighbors);
      }
    }
  }

  listNeighborsAround(worldCoordinate: Phaser.Point, radius: number) {
    if (radius === 0) {
      return [];
    }

    if (!(radius >= 0 && radius * 2 <= PhysicalConstants.WORLD_SIZE)) {
      throw new Error(`Radius '${radius}' is invalid`);
    }

    let topLeft = this.toChunkCoordinate(worldCoordinate.clone().subtract(radius, radius));
    let bottomRight = this.toChunkCoordinate(worldCoordinate.clone().add(radius, radius));
    if (topLeft.x > bottomRight.x) {
      bottomRight.x += this.chunksCount;
    }
    if (topLeft.y > bottomRight.y) {
      bottomRight.y += this.chunksCount;
    }
    return this.listChunksInBound(topLeft.x, bottomRight.x, topLeft.y, bottomRight.y);
  }

  isInSameRegion(worldCoordinate: Phaser.Point, otherCoordinate: Phaser.Point): boolean {
    return this.toChunkCoordinate(worldCoordinate).equals(this.toChunkCoordinate(otherCoordinate));
  }

  private listChunksInBound(
      left: number,
      right: number,
      top: number,
      bottom: number): Array<Chunk<E>> {
    let chunks: Array<Chunk<E>> = [];
    this.pushChunksInBound(left, right, top, bottom, chunks);
    return chunks;
  }

  /**
   * Handles bounds that wrap around the world.
   * However, right and bottom must be greater than left and top, respectively.
   */
  private pushChunksInBound(
      left: number,
      right: number,
      top: number,
      bottom: number,
      chunks: Array<Chunk<E>>): void {
    for (let indexY = top; indexY <= bottom; indexY++) {
      let y = (indexY + this.chunksCount) % this.chunksCount;
      for (let indexX = left; indexX <= right; indexX++) {
        let x = (indexX + this.chunksCount) % this.chunksCount;
        chunks.push(this.chunks[y][x]);
      }
    }
  }

  /**
   * Wraps coordinates that are out of one side of the world to the other side.
   */
  private toChunkCoordinate(worldCoordinate: Phaser.Point): Phaser.Point {
    let coordinate = worldCoordinate.clone().divide(this.chunkSize, this.chunkSize).floor();
    coordinate.x = (coordinate.x % this.chunksCount + this.chunksCount) % this.chunksCount;
    coordinate.y = (coordinate.y % this.chunksCount + this.chunksCount) % this.chunksCount;

    if (isNaN(coordinate.x)
        || !isFinite(coordinate.x)
        || isNaN(coordinate.y)
        || !isFinite(coordinate.y)) {
      throw new Error('Invalid world coordinate');
    }

    return coordinate;
  }

  /**
   * If bounds are beyond the left or top of the world, they will be wrapped to the opposite ends.
   * All coordinates are guaranteed to be greater than or equal to 0.
   */
  private inflate(chunkCoordinate: Phaser.Point, n: number): Phaser.Rectangle {
    let bound = new Phaser.Rectangle(chunkCoordinate.x, chunkCoordinate.y, 1, 1)
        .inflate(n, n)
        .offset(this.chunksCount, this.chunksCount);
    bound.x %= this.chunksCount;
    bound.y %= this.chunksCount;
    return bound;
  }

  private getChunk(x: number, y: number) {
    return this.chunks[y][x];
  }
}

/**
 * Implements {@link Region} with an array.
 */
export class Chunk<E extends Entity> extends Region<E> {
  private entities: E[];

  constructor(coordinate: Phaser.Point) {
    super(coordinate);
    this.entities = [];
  }

  addEntity(entity: E) {
    // TODO test entity is not double added
    // TODO test entity.coordinate >= 0
    this.entities.push(entity);
  }

  countEntities() {
    return this.entities.length;
  }

  forEach(f: (value: E, index: number) => void, thisArg?: any) {
    return this.entities.forEach(f, thisArg);
  }
}