import Point from '../../syntax/Point';
import {toWorldCoordinate2d, validateRadius} from '../../../law';
import PhysicalConstants from '../../../PhysicalConstants';
import IterablesIterator from '../../iteration/IterablesIterator';

class Chunks<T> implements Iterable<T> {
  constructor(private chunks: T[][], private chunkSize: number) {
    if (chunkSize <= 0) {
      throw new TypeError('Invalid chunk size');
    }

    let chunksWidths = new Set(chunks.map(chunksRow => chunksRow.length));
    if (chunksWidths.size !== 1) {
      throw new TypeError('Invalid chunks dimension');
    }

    if (chunks[0].length === 0) {
      throw new TypeError('Chunks cannot be empty');
    }
  }

  getChunkByCoordinates(coordinates: Point) {
    let chunkCoordinates = this.toChunkCoordinates(coordinates);
    return this.getChunkByChunkCoordinates(chunkCoordinates.x, chunkCoordinates.y);
  }

  listChunksInBounds(bounds: Phaser.Rectangle): T[] {
    validateRadius(bounds.width / 2);
    validateRadius(bounds.height / 2);

    let topLeft = this.toChunkCoordinates(bounds.topLeft);

    let bottomRight = this.toChunkCoordinates(bounds.bottomRight);
    if (bottomRight.y < topLeft.y) {
      bottomRight.y += this.chunks.length;
    }
    if (bottomRight.x < topLeft.x) {
      bottomRight.x += this.chunks[0].length;
    }

    let chunks = [];
    for (let y = topLeft.y; y <= bottomRight.y; y++) {
      for (let x = topLeft.x; x <= bottomRight.x; x++) {
        chunks.push(this.getChunkByChunkCoordinates(x, y));
      }
    }

    return chunks;
  }

  [Symbol.iterator](): Iterator<T> {
    return IterablesIterator.of(this.chunks);
  }

  private getChunkByChunkCoordinates(chunkCoordinateX: number, chunkCoordinateY: number) {
    return this.chunks[chunkCoordinateY][chunkCoordinateX];
  }

  /**
   * Also, wraps coordinates that are out of one side of the world to the other side.
   */
  private toChunkCoordinates(coordinates: Point): Point {
    return toWorldCoordinate2d(coordinates, PhysicalConstants.WORLD_SIZE)
        .divide(this.chunkSize, this.chunkSize)
        .floor();
  }
}

export default Chunks;
