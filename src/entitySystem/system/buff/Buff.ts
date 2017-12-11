import {Component} from '../../alias';

/**
 * System that applies to a unique entity
 */
interface Buff<T extends Component = Component> {
  apply(component: T): void;
}

export default Buff;
