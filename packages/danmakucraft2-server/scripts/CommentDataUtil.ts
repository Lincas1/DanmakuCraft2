import CommentData from '../../danmakucraft2-client/src/comment/CommentData';
import {BuffData, BuffType} from '../../danmakucraft2-client/src/entitySystem/system/buff/BuffData';
import Point from '../../danmakucraft2-client/src/util/syntax/Point';

class CommentDataUtil {
  static readonly METADATA_DELIMITER = '/[';

  static parseFromDocument(document: Document): CommentData[] {
    return Array.from(document.getElementsByTagName('d'))
        .map(commentElement => {
          let attributes = commentElement.attributes.getNamedItem('p').value;
          let text = commentElement.textContent || '';
          return this.parseFromXmlLine(attributes, text);
        })
        .filter(Boolean) as CommentData[];
  }

  static parseFromXmlLine(attributes: string, text: string): CommentData | null {
    // Parse metadata
    let indexMetadata = text.lastIndexOf(this.METADATA_DELIMITER);
    if (indexMetadata === -1) {
      return null;
    }

    let metadataText = text.slice(indexMetadata + this.METADATA_DELIMITER.length);
    let properties = [];
    for (let i = 0; i < metadataText.length; i++) {
      properties.push(metadataText.charCodeAt(i));
    }

    try {
      properties = this.toActualCharCodes(properties);
    } catch (ignored) {
      return null;
    }

    // Parse comment text
    let commentText = text.slice(0, indexMetadata);

    // Parse properties
    let positionX;
    let positionY;
    let buffData = null;
    if (properties.length === 2) {
      [positionX, positionY] = properties;
    } else if (properties.length === 4) {
      let buffType;
      let buffParameter;
      [positionX, positionY, buffType, buffParameter] = properties;
      if (BuffType[buffType] != null) {
        buffData = new BuffData(buffType, buffParameter);
      }
    } else {
      return null;
    }

    // Parse attributes
    let [, , size, color] = attributes.split(',');

    return new CommentData(
        Number(size),
        Number(color),
        commentText,
        Point.of(positionX, positionY),
        buffData);
  }

  // Thanks @UHI for av488629
  // every char code in the string must be in [0, 0x8000)
  private static toActualCharCodes(codes: number[]): number[] {
    if (!codes.every(
            code => (code >= 0x4000 && code <= 0x9fff) || (code >= 0xb000 && code <= 0xcfff))) {
      throw new Error(`Invalid char codes: ${codes}`);
    }
    return codes.map(code => code - (code < 0xb000 ? 0x4000 : 0x5000));
  }
}

export default CommentDataUtil;
