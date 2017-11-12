import * as $ from 'jquery';
import {
  CommentProvider,
  EnvironmentAdapter,
  GameContainerProvider,
  NewCommentEvent
} from './inwardAdapter';
import {EventDispatcher} from '../util';
import {bindFirst, webSocketManager} from './util';
import {CommentData} from '../comment';
import {TextDecoder, TextEncoder} from 'text-encoding-shim';
import {WorldProxy} from './outwardAdapter';
import Timer = NodeJS.Timer;

export default class BilibiliAdapter implements EnvironmentAdapter {
  worldProxy: WorldProxy;

  constructor() {
    this.worldProxy = null;
  }

  getCommentProvider(): CommentProvider {
    if (this.worldProxy == null) {
      throw new Error('WorldProxy is not set');
    }
    return new BilibiliCommentProvider(this.worldProxy);
  }

  setWorldProxy(worldProxy: WorldProxy) {
    this.worldProxy = worldProxy;
  }

  getGameContainerProvider(): GameContainerProvider {
    return new BilibiliContainerProvider();
  }
}

class BilibiliContainerProvider implements GameContainerProvider {
  getContainer(): HTMLElement {
    if (!BilibiliContainerProvider.canRunOnThisWebPage()) {
      throw new Error('Script cannot be run on this page');
    }

    // TODO check if wrap content is recovered on fullscreen / widescreen change.
    let $videoFrame = $('.bilibili-player-video-wrap');
    $videoFrame.empty();

    return $videoFrame[0];
  }

  private static canRunOnThisWebPage() {
    if (EnvironmentVariables.aid !== Parameters.AID) {
      return false;
    }
    return true;
  }
}

class BilibiliCommentProvider extends CommentProvider {
  receiver: RemoteCommentReceiver;
  injector: LocalCommentInjector;

  constructor(worldProxy: WorldProxy) {
    super();

    this.injector = new LocalCommentInjector(worldProxy);

    this.receiver = new RemoteCommentReceiver(EnvironmentVariables.chatBroadcastUrl);
    this.receiver.addEventListener(CommentProvider.NEW_COMMENT, this.onNewComment.bind(this));
  }

  private onNewComment(event: NewCommentEvent) {
    this.dispatchEvent(event);
  }

  async getAllComments(): Promise<CommentData[]> {
    return new Promise<Document>((resolve, reject) => {
      $.ajax({
        type: 'GET',
        url: EnvironmentVariables.commentXmlUrl,
        dataType: 'xml',
        success: resolve,
        error: reject,
      });
    })
        .then(data => {
          return (data.getElementsByTagName('d') as any as Node[])
              .map(commentElement => {
                let attributes = commentElement.attributes.getNamedItem('p').value;
                let text = commentElement.textContent;
                return CommentDataUtil.parseFromXmlStrings(attributes, text);
              })
              .filter(Boolean);
        }, xhr => {
          let msg = `Cannot get comments from ${EnvironmentVariables.commentXmlUrl}: ${xhr.statusText}`;
          throw new Error(msg);
        });
  }
}

class LocalCommentInjector {
  private $textInput: JQuery<HTMLElement>;
  private $sendButton: JQuery<HTMLElement>;

  constructor(private worldProxy: WorldProxy) {
    this.$textInput = $('.bilibili-player-video-danmaku-input');

    this.$sendButton = $('.bilibili-player-video-btn-send');
    bindFirst(this.$sendButton, 'click', this.onClickSendButtonInitial.bind(this));
  }

  /**
   * Appends metadata to a comment to be sent. Does not provide comments, because every comment
   * sent is expected to be received by RemoteCommentReceiver.
   */
  private onClickSendButtonInitial(event: Event) {
    if (this.isSendButtonDisabled()) {
      return;
    }

    let commentText = this.$textInput.val().toString();

    if (commentText === '') {
      return;
    }

    let injectedCommentText = this.buildInjectedCommentText(commentText);

    let $fontSelection = $('.bilibili-player-mode-selection-row.fontsize .selection-span.active');
    let commentSize = parseInt($fontSelection.attr('data-value'), 10);

    if (!this.worldProxy.requestForPlacingComment(commentText, commentSize)) {
      event.stopImmediatePropagation();
      return;
    }

    // Update comment text in UI and let player check if the text is valid.
    this.$textInput.val(injectedCommentText);
    this.$textInput.trigger('input');

    // If the text is invalid, the button would be disabled.
    if (this.isSendButtonDisabled()) {
      // Restore the comment text and let through the event, so that user would see the disabled
      // button, but not comment changes.
      this.$textInput.val(commentText);
    }
  }

  private buildInjectedCommentText(text: string): string {
    throw new Error('Not implemented'); // TODO
    // return text + CommentDataUtil.generateCommentMetadata(text, x, y);
  }

  private isSendButtonDisabled() {
    return this.$sendButton.hasClass('bpui-state-disabled');
  }
}

class RemoteCommentReceiver extends EventDispatcher<NewCommentEvent> {
  private socket: WebSocket;
  private doRetry: boolean;
  private heartBeat: Timer;

  private static frameDefinitionEntries = [
    {name: 'Header Length', key: 'headerLen', size: 2, offset: 4, value: 16},
    {name: 'Protocol Version', key: 'ver', size: 2, offset: 6, value: 1},
    {name: 'Operation', key: 'op', size: 4, offset: 8, value: 2},
    {name: 'Sequence Id', key: 'seq', size: 4, offset: 12, value: 1},
  ];

  constructor(private url: string) {
    super();

    this.doRetry = true;
    this.heartBeat = null;

    this.startWebSocket();
  }

  private startWebSocket() {
    this.socket = webSocketManager.build(this.url);
    this.socket.binaryType = 'arraybuffer';

    let that = this;
    this.socket.onopen = () => {
      that.sendInitialMessage();
    };

    this.socket.onmessage = this.onMessage.bind(this);

    this.socket.onclose = event => {
      console.debug('RemoteCommentReceiver onClose', event);

      clearTimeout(that.heartBeat);

      if (that.doRetry) {
        setTimeout(() => {
          that.startWebSocket();
        }, 5 * 1e3);
      }
    };
  }

  private sendInitialMessage() {
    let that = this;

    let data: any = {
      uid: EnvironmentVariables.uid,
      roomid: Parameters.ROOM_ID,
      protover: 1,
    };
    if (EnvironmentVariables.aid) {
      data.aid = EnvironmentVariables.aid;
    }
    data.from = 7;
    let message = this.encode(data, 7);

    setTimeout(() => {
      that.socket.send(message);
    }, 0);
  }

  private startHeartBeat() {
    let that = this;

    clearTimeout(this.heartBeat);

    let data = this.encode({}, 2);
    this.socket.send(data);

    this.heartBeat = setTimeout(() => {
      that.startHeartBeat();
    }, 30 * 1e3);
  }

  private onMessage(event: { data: ArrayBuffer }) {
    console.debug('RemoteCommentReceiver onMessage', event);

    try {
      let data = this.parse(event.data);
      if (data instanceof Array) {
        data.forEach(b => {
          this.onMessage(b);
        });
      } else if (data instanceof Object) {
        switch (data.op) {
          case 5:
            this.onReceivedMessage(data.body);
            break;
          case 8:
            this.startHeartBeat();
            break;
          default:
            break;
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  private onReceivedMessage(body: any) {
    if (body instanceof Array) {
      body.map(b => {
        this.onReceivedMessage(b);
      });
    } else if (body instanceof Object) {
      this._onReceivedMessage(body);
    }
  }

  private _onReceivedMessage(body: any) {
    if (!body) {
      return;
    }
    let info = body.info;
    if (body.cmd === 'DM') {
      if (info instanceof Array) {
        let attributes = info[0];
        let text = info[1];
        let comment = CommentDataUtil.parseFromXmlStrings(attributes, text);

        this.dispatchEvent(new NewCommentEvent(comment));
      }
    }
  }

  // destroy() {
  //   clearTimeout(this.heartBeat);
  //
  //   this.doRetry = false;
  //
  //   if (this.socket) {
  //     this.socket.close();
  //     this.socket = null;
  //   }
  // }

  private encode(data: any, protocolVersion: number) {
    let textEncoder = new TextEncoder();
    let dataArray = textEncoder.encode(JSON.stringify(data));

    let metadataView = new DataView(new ArrayBuffer(16), 0);
    metadataView.setInt32(0, 16 + dataArray.byteLength);
    metadataView.setInt32(0, 16 + dataArray.byteLength);
    RemoteCommentReceiver.frameDefinitionEntries[2].value = protocolVersion;
    RemoteCommentReceiver.frameDefinitionEntries.forEach(entry => {
      if (entry.size === 4) {
        metadataView.setInt32(entry.offset, entry.value);
      } else if (entry.size === 2) {
        metadataView.setInt16(entry.offset, entry.value);
      }
    });

    return RemoteCommentReceiver.mergeBuffers(metadataView.buffer, dataArray.buffer);
  }

  private static mergeBuffers(b: ArrayBuffer, c: ArrayBuffer): ArrayBuffer {
    let arrayB = new Uint8Array(b);
    let arrayC = new Uint8Array(c);
    let d = new Uint8Array(arrayB.byteLength + arrayC.byteLength);
    d.set(arrayB, 0);
    d.set(arrayC, arrayB.byteLength);
    return d.buffer;
  }

  private parse(buffer: ArrayBuffer) {
    let bufferView = new DataView(buffer);

    let data: any = {
      packetLen: bufferView.getInt32(0),
    };
    RemoteCommentReceiver.frameDefinitionEntries.forEach(entry => {
      if (entry.size === 4) {
        data[entry.key] = bufferView.getInt32(entry.offset);
      } else if (entry.size === 2) {
        data[entry.key] = bufferView.getInt16(entry.offset);
      }
    });

    if (data.op && data.op === 5) {
      data.body = [];
      let decoder = new TextDecoder();
      let step = data.packetLen;
      for (let i = 0; i < buffer.byteLength; i += step) {
        step = bufferView.getInt32(i);
        let l = bufferView.getInt16(i + 4);
        try {
          // TODO test
          let slicedBuffer = buffer.slice(i + l, i + step);
          let slicedBufferView = new DataView(slicedBuffer);
          let value = JSON.parse(decoder.decode(slicedBufferView));
          data.body.push(value);
        } catch (ignored) {
        }
      }
    } else if (data.op && data.op === 3) {
      data.body = {
        count: bufferView.getInt32(16),
      };
    }

    return data;
  }
}

class CommentDataUtil {
  static readonly METADATA_DELIMITER = '/[';

  static parseFromXmlStrings(attributes: string, text: string) {
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

    // Validate by MAC
    let tag = properties.pop();
    let tag2 = this.mac(commentText, properties);
    if (tag !== tag2) {
      return null;
    }

    // Parse properties
    let positionX;
    let positionY;
    let advancedCommentType;
    let advancedCommentParameter;
    if (properties.length === 2) {
      [positionX, positionY] = properties;
      advancedCommentType = null;
      advancedCommentParameter = null;
    } else if (properties.length === 4) {
      [positionX, positionY, advancedCommentType, advancedCommentParameter] = properties;
    } else {
      return null;
    }

    // Parse attributes
    let [showTime, mode, size, color, sendTime, userId] =
        attributes.split(',').map(Number);

    return new CommentData(
        showTime,
        mode,
        size,
        color,
        sendTime,
        userId,
        commentText,
        positionX,
        positionY,
        advancedCommentType,
        advancedCommentParameter);
  }

  static generateCommentMetadata(text: string, commentX: number, commentY: number) {
    // All properties must be in [0, 0x8000)
    let properties = [
      commentX,
      commentY,
    ];

    // // TODO EffectManager.apply?
    // if (player.effect) {
    //   properties.push(player.effect.type, player.effect.behavior);
    //   player.effect = null; // effect is consumed
    // }

    let tag = this.mac(text, properties);
    properties.push(tag);

    let encodedProperties = this.toSafeCharCodes(properties);

    let metadata = this.METADATA_DELIMITER + String.fromCharCode(...encodedProperties);

    return metadata;
  }

  private static mac(message: string, properties: number[]): number {
    // Modulo is not necessary, but keep it for compatibility.
    let firstCharCode = message.charCodeAt(0) % 0x8000;
    return this.hash(firstCharCode, ...properties);
  }

  private static hash(...codes: number[]): number {
    let ret = 0;
    codes = [44, 56, 55, 104, ...codes, 123, 99, 73, 98];  // `,87h${text}{cIb`
    for (let i = codes.length - 1; i >= 0; i--) {
      ret <<= 1;
      ret = 31 * ret + codes[i];
    }
    ret = (ret >> 15) ^ ret;
    ret %= 0x8000;
    return ret;
  }

  // Thanks @UHI for av488629
  // every char code in the string must be in [0, 0x8000)
  private static toSafeCharCodes(codes: number[]): number[] {
    if (codes.some(code => code < 0x8000)) {
      throw new Error(`Invalid char codes: ${codes}`);
    }
    return codes.map(code => (code < 0x6000 ? 0x4000 : 0x5000) + code);
  }

  private static toActualCharCodes(codes: number[]): number[] {
    if (!codes.every(
            code => (code >= 0x4000 && code <= 0x9fff) || (code >= 0xb000 && code <= 0xcfff))) {
      throw new Error(`Invalid char codes: ${codes}`);
    }
    return codes.map(code => code - (code < 0xb000 ? 0x4000 : 0x5000));
  }
}

class EnvironmentVariables {
  static readonly aid: number = parseInt((window as any).aid, 10);
  static readonly cid: number = parseInt((window as any).cid, 10);
  static readonly uid: string = (window as any).uid;
  static readonly isHttps: boolean = window.location.protocol === 'https://';

  static buildUrl(protocolName: string, url: string) {
    return `${protocolName}${this.isHttps ? 's' : ''}://${url}`;
  }

  static readonly commentXmlUrl: string = EnvironmentVariables.buildUrl(
      'http', `comment.bilibili.com/${EnvironmentVariables.cid}.xml`);
  static readonly chatBroadcastUrl: string = EnvironmentVariables.buildUrl(
      'ws', 'broadcast.chat.bilibili.com:4095/sub');
}

class Parameters {
  static readonly ROOM_ID: number = 4145439; // TODO update to real one
  static readonly AID: number = 2718860; // TODO update to real one
}
