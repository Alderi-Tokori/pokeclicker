import { MineConfig, MineType } from './MineConfig';
import { Observable } from 'knockout';
import Rand from '../../utilities/Rand';
import UndergroundItem from '../UndergroundItem';
import { UndergroundController } from '../UndergroundController';
import UndergroundItems from '../UndergroundItems';
import OakItemType from '../../enums/OakItemType';
import GameHelper from '../../GameHelper';
import {Underground} from "../Underground";

export type Coordinate = {
    x: number;
    y: number;
};

type MineProperties = {
    width: number;
    height: number;

    minimumDepth?: number;
    maximumExtraLayers?: number;

    minimumItemsToGenerate: number;
    extraItemsToGenerate: number;

    timeToDiscover: number;

    config?: MineConfig;
};

type RewardProperties = {
    id: number;
    undergroundItemID: number;
    localCoordinate: Coordinate;
    backgroundPosition: string;
    rotations: number;
    rewarded: Observable<boolean>;
};

export enum MineStateType {
    None,
    Loading,
    Undiscovered,
    Active,
    Completed,
    Abandoned,
}

class Reward {
    private _properties: RewardProperties;
    constructor(rewardProperties: RewardProperties) {
        this._properties = rewardProperties;
    }

    get rewardID(): number {
        return this._properties.id;
    }

    get undergroundItemID() {
        return this._properties.undergroundItemID;
    }

    get localCoordinate(): Coordinate {
        return this._properties.localCoordinate;
    }

    get backgroundPosition(): string {
        return this._properties.backgroundPosition;
    }

    get rotations(): number {
        return this._properties.rotations;
    }

    get rewarded(): boolean {
        return this._properties.rewarded();
    }

    set rewarded(value: boolean) {
        this._properties.rewarded(value);
    }

    public save = () => ({
        ...this._properties,
        rewarded: this._properties.rewarded(),
    });

    public load = (json) => {
        this._properties = {
            ...json,
            rewarded: ko.observable<boolean>(json.rewarded),
        };
    };

    public static load = (json): Reward => new Reward({
        ...json,
        rewarded: ko.observable<boolean>(json.rewarded),
    });
}

class Tile {
    private _layerDepth: Observable<number>;
    private _reward?: Reward;
    private _survey: Observable<number>;

    constructor(layerDepth: number) {
        this._layerDepth = ko.observable<number>(layerDepth);
        this._survey = ko.observable<number>(-1);
    }

    get layerDepth(): number {
        return this._layerDepth();
    }

    set layerDepth(value: number) {
        this._layerDepth(Math.max(value, 0));
    }

    get reward(): Reward {
        return this._reward;
    }

    set reward(value: Reward) {
        this._reward = value;
    }

    get survey(): number | undefined {
        return this._survey?.();
    }

    set survey(range: number) {
        this._survey(range);
    }

    public save = () => ({
        layerDepth: this._layerDepth(),
        reward: this._reward?.save(),
        survey: this._survey(),
    });

    public static load = (json): Tile => {
        const tile = new Tile(json.layerDepth);
        tile.survey = json.survey;

        if (json.reward) {
            tile.reward = Reward.load(json.reward);
        }

        return tile;
    };
}

export class Mine {
    public static DEFAULT_MINIMUM_DEPTH: number = 3;
    public static DEFAULT_MAXIMUM_EXTRA_LAYERS: number = 2;
    public static MAXIMUM_PLACEMENT_ATTEMPTS: number = 1000;

    private _mineProperties: MineProperties;
    private _grid: Array<Tile>;

    private _timeUntilDiscovery: Observable<number> = ko.observable(0);

    private _itemsBuried: Observable<number> = ko.observable(0);
    private _itemsFound: Observable<number> = ko.observable(0);
    private _itemsPartiallyFound: Observable<number> = ko.observable(0);

    public static bestI = -1;
    public static bestJ = -1;
    public static bestToolToUse = Mine.Tool.Chisel;

    private _completed: Observable<boolean> = ko.observable(false);

    constructor(mineProperties: MineProperties) {
        this._mineProperties = mineProperties;
        this._timeUntilDiscovery(mineProperties.timeToDiscover);
    }

    public tick(deltaTime: number) {
        if (!this.completed) {
            this._timeUntilDiscovery(this.timeUntilDiscovery - deltaTime);
        }
    }

    public generate() {
        this._generateGrid();
        this._generateUndergroundItems();
    }

    private _generateGrid() {
        this._grid = Array.from({ length: this._mineProperties.width * this._mineProperties.height },
            () => new Tile(Rand.intBetween(0, this._mineProperties.maximumExtraLayers ?? Mine.DEFAULT_MAXIMUM_EXTRA_LAYERS) + (this._mineProperties.minimumDepth ?? Mine.DEFAULT_MINIMUM_DEPTH)));
    }

    private _generateUndergroundItems() {
        if (!this._grid?.length) {
            this._generateGrid();
        }

        const numberOfItemsToGenerate: number = this._mineProperties.config.fixedItemCount ?? Rand.intBetween(
            this._mineProperties.minimumItemsToGenerate,
            this._mineProperties.minimumItemsToGenerate + this._mineProperties.extraItemsToGenerate,
        );
        const availableItems: UndergroundItem[] = this._mineProperties.config.getAvailableItems();

        for (let rewardIndex = 0; rewardIndex < numberOfItemsToGenerate; rewardIndex++) {
            const undergroundItem: UndergroundItem = Rand.fromWeightedArray(availableItems, availableItems.map(value => value.getWeight()));
            let placementAttemptSucceeded = false;
            let attemptCount = 0;

            while (!placementAttemptSucceeded && attemptCount < Mine.MAXIMUM_PLACEMENT_ATTEMPTS) {
                const rotations = Rand.floor(4);
                const localSpace = UndergroundController.rotateMatrix90Clockwise(undergroundItem.space, rotations);
                const randomCoordinate = this.getRandomCoordinate();

                placementAttemptSucceeded = this._attemptPlaceReward(undergroundItem, rewardIndex, randomCoordinate, localSpace, rotations);

                ++attemptCount;
            }
        }

        this._updateItemsBuriedObservable();
        this._updateItemsFoundObservable();
        this._updateItemsPartiallyFoundObservable();
    }

    private _canPlaceReward(coordinate: Coordinate, localSpace: Array<Array<number>>): boolean {
        if (!this._grid?.length)
            return false;

        const rewardWidth = localSpace[0].length;
        const rewardHeight = localSpace.length;

        if (coordinate.x + rewardWidth > this._mineProperties.width || coordinate.y + rewardHeight > this._mineProperties.height)
            return false;

        for (let localXCoordinate = 0; localXCoordinate < rewardWidth; localXCoordinate++) {
            for (let localYCoordinate = 0; localYCoordinate < rewardHeight; localYCoordinate++) {
                if (localSpace[localYCoordinate][localXCoordinate] !== 0) {
                    const mineXCoordinate = coordinate.x + localXCoordinate;
                    const mineYCoordinate = coordinate.y + localYCoordinate;

                    if (this._grid[this.getGridIndexForCoordinate({ x: mineXCoordinate, y: mineYCoordinate })].reward) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    private _attemptPlaceReward(undergroundItem: UndergroundItem, rewardIndex: number, coordinate: Coordinate, localSpace: Array<Array<number>>, rotations: number): boolean {
        if (!this._canPlaceReward(coordinate, localSpace)) {
            return false;
        }

        const rewardWidth = localSpace[0].length;
        const rewardHeight = localSpace.length;

        const { space } = undergroundItem;
        let backgroundPositionSpace: Array<Array<string>> = Array.from({ length: space.length }, (_, i) => Array.from({ length: space[0].length }, (__, j) => {
            const xPercentage = `${(100 * j / (space[0].length - 1)).toFixed(2)}%`;
            const yPercentage = `${(100 * i / (space.length - 1)).toFixed(2)}%`;
            return `${xPercentage} ${yPercentage}`;
        }));
        backgroundPositionSpace = UndergroundController.rotateMatrix90Clockwise(backgroundPositionSpace, rotations);

        for (let localXCoordinate = 0; localXCoordinate < rewardWidth; localXCoordinate++) {
            for (let localYCoordinate = 0; localYCoordinate < rewardHeight; localYCoordinate++) {
                if (localSpace[localYCoordinate][localXCoordinate] !== 0) {
                    const mineXCoordinate = coordinate.x + localXCoordinate;
                    const mineYCoordinate = coordinate.y + localYCoordinate;

                    this._grid[this.getGridIndexForCoordinate({ x: mineXCoordinate, y: mineYCoordinate })].reward = new Reward({
                        id: rewardIndex,
                        undergroundItemID: undergroundItem.id,
                        localCoordinate: {
                            x: localXCoordinate,
                            y: localYCoordinate,
                        },
                        backgroundPosition: backgroundPositionSpace[localYCoordinate][localXCoordinate],
                        rotations: rotations,
                        rewarded: ko.observable<boolean>(false),
                    });
                }
            }
        }

        return true;
    }

    public getRandomCoordinate(): Coordinate {
        return {
            x: Rand.floor(this._mineProperties.width),
            y: Rand.floor(this._mineProperties.height),
        };
    }

    public getCoordinateForGridIndex(index: number): Coordinate | null {
        if (index < 0 || index >= (this.grid?.length || 0))
            return null;

        return {
            x: index % this._mineProperties.width,
            y: Math.floor(index / this._mineProperties.width),
        };
    }

    public getGridIndexForCoordinate(coordinate: Coordinate): number {
        if (coordinate.x < 0 || coordinate.y < 0)
            return -1;
        if (coordinate.x >= this._mineProperties.width || coordinate.y >= this._mineProperties.height)
            return -1;

        return coordinate.y * this._mineProperties.width + coordinate.x;
    }

    private getTileForCoordinate(coordinate: Coordinate) {
        const index = this.getGridIndexForCoordinate(coordinate);
        if (index < 0 || index >= (this._grid?.length || 0))
            return null;

        return this._grid[index];
    }

    public survey(coordinate: Coordinate, range: number) {
        const tile = this.getTileForCoordinate(coordinate);

        if (!tile) {
            return;
        }

        tile.survey = range;
    }

    public attemptBreakTile(coordinate: Coordinate, layers: number = 1): boolean {
        const tile = this.getTileForCoordinate(coordinate);

        if (tile && tile.layerDepth > 0) {
            tile.layerDepth -= layers;

            if (tile.layerDepth === 0) {
                this._updateItemsPartiallyFoundObservable();
            }

            App.game.underground.battery.charge();
            return true;
        }

        return false;
    }

    public attemptFindItem(coordinate: Coordinate): { item: UndergroundItem, amount: number } {
        const digTile: Tile = this.getTileForCoordinate(coordinate);

        if (!digTile || !digTile.reward || digTile.layerDepth > 0 || digTile.reward.rewarded) {
            return null;
        }

        const undergroundItemTiles: Tile[] = this._grid.filter(tile => tile.reward && tile.reward.rewardID === digTile.reward.rewardID);

        if (!undergroundItemTiles.every(tile => tile.layerDepth === 0)) {
            return null;
        }

        undergroundItemTiles.forEach(tile => {
            tile.reward.rewarded = true;
        });

        this._updateItemsFoundObservable();

        const amount = UndergroundController.calculateRewardAmountFromMining();

        App.game.oakItems.use(OakItemType.Treasure_Scanner);
        GameHelper.incrementObservable(App.game.statistics.undergroundItemsFound, amount);

        return {
            item: UndergroundItems.getById(digTile.reward.undergroundItemID),
            amount: amount,
        };
    }

    public attemptCompleteLayer(): boolean {
        if (!this.completed && this.itemsBuried > 0 && this.itemsFound === this.itemsBuried) {
            this._completed(true);

            GameHelper.incrementObservable(App.game.statistics.undergroundLayersMined);
            App.game.oakItems.use(OakItemType.Explosive_Charge);

            return true;
        }

        return false;
    }

    get grid(): Tile[] {
        return this._grid;
    }

    get timeUntilDiscovery(): number {
        return this._timeUntilDiscovery();
    }

    get itemsBuried(): number {
        return this._itemsBuried();
    }

    get itemsFound(): number {
        return this._itemsFound();
    }

    get itemsPartiallyFound(): number {
        return this._itemsPartiallyFound();
    }

    get completed(): boolean {
        return this._completed();
    }

    get width(): number {
        return this._mineProperties.width;
    }

    get height(): number {
        return this._mineProperties.height;
    }

    get mineType(): MineType {
        return this._mineProperties.config.type;
    }

    get initialTimeToDiscover(): number {
        return this._mineProperties.timeToDiscover;
    }

    private _updateItemsBuriedObservable() {
        this._itemsBuried(new Set(this._grid.filter(tile => tile.reward).map(tile => tile.reward.rewardID)).size);
    }

    private _updateItemsFoundObservable() {
        this._itemsFound(new Set(this._grid.filter(tile => tile.reward && tile.reward.rewarded).map(tile => tile.reward.rewardID)).size);
    }

    private _updateItemsPartiallyFoundObservable() {
        this._itemsPartiallyFound(new Set(this._grid.filter(tile => tile.reward && tile.layerDepth === 0).map(tile => tile.reward.rewardID)).size);
    }

    public save() {
        return {
            properties: this._mineProperties,
            grid: this._grid.map(value => value.save()),
            timeUntilDiscovery: this._timeUntilDiscovery(),
            completed: this._completed(),
        };
    }

    public static load(json): Mine {
        const mine = new Mine(json.properties);
        mine._grid = json.grid?.map(value => Tile.load(value));
        mine._timeUntilDiscovery(json.timeUntilDiscovery || json.properties.timeToDiscover);
        mine._completed(json.completed || false);

        mine._updateItemsBuriedObservable();
        mine._updateItemsFoundObservable();
        mine._updateItemsPartiallyFoundObservable();

        return mine;
    }


    // public static indicateOptimalSpotToBreak() {
    //     let gridScoresChisel = new Array(Mine.grid.length).fill(0).map(() => new Array(Mine.grid[0].length).fill(0));
    //     let gridScoresHammer = new Array(Mine.grid.length).fill(0).map(() => new Array(Mine.grid[0].length).fill(0));
    //
    //     let revealedItems = [];
    //     for (let y = 0; y < Mine.rewardGrid.length; ++y) {
    //         for (let x = 0; x < Mine.rewardGrid[y].length; ++x) {
    //             if (Mine.rewardGrid[y][x] != 0 && Mine.rewardGrid[y][x].revealed == 1 && !revealedItems.includes(Mine.rewardGrid[y][x].value)) {
    //                 revealedItems.push(Mine.rewardGrid[y][x].value);
    //             }
    //         }
    //     }
    //
    //     $('#mineBody div').removeClass('spot-to-break');
    //
    //     let bestI = -1;
    //     let bestJ = -1;
    //     let bestScore = 0;
    //     let bestDistanceToCenter = 0;
    //     let bestToolToUse = Mine.Tool.Chisel;
    //     let centerI = (gridScoresChisel.length - 1) / 2;
    //     let centerJ = (gridScoresChisel[0].length - 1) / 2;
    //
    //     if (revealedItems.length < Mine.itemsBuried()) {
    //         // Memorizing places where we know an item is present
    //         let gridKnownPlaces = new Array(Mine.grid.length).fill(0).map(() => new Array(Mine.grid[0].length).fill(0));
    //         for (let y = 0; y < Mine.rewardGrid.length; ++y) {
    //             for (let x = 0; x < Mine.rewardGrid[y].length; ++x) {
    //                 if (Mine.grid[y][x]() == 0 || (Mine.rewardGrid[y][x] != 0 && revealedItems.includes(Mine.rewardGrid[y][x].value))) {
    //                     gridKnownPlaces[y][x] = 1;
    //                 }
    //             }
    //         }
    //
    //         // Looping through all items to find the best spot to break
    //         UndergroundItems.list.forEach(item => {
    //             let space = item.space;
    //
    //             for (let rotation = 0; rotation < 4; ++rotation) {
    //                 const spaceLength = space.length;
    //                 let newSpace = new Array(space[0].length).fill(0).map(() => new Array(spaceLength).fill(0));
    //
    //                 for (let i = 0; i < space.length; i++) {
    //                     for (let j = 0; j < space[0].length; j++) {
    //                         newSpace[j][space.length - 1 - i] = space[i][j];
    //                     }
    //                 }
    //
    //                 space = newSpace;
    //
    //                 for (let y = 0; y < gridKnownPlaces.length - (space.length - 1); ++y) {
    //                     checkItemPosition: for (let x = 0; x < gridKnownPlaces[y].length - (space[0].length - 1); ++x) {
    //                         // Check if item can be placed in this position
    //                         for (let i = 0; i < space.length; i++) {
    //                             for (let j = 0; j < space[i].length; j++) {
    //                                 if (space[i][j].value !== 0) {
    //                                     if (gridKnownPlaces[i + y][j + x] !== 0) {
    //                                         continue checkItemPosition;
    //                                     }
    //                                 }
    //                             }
    //                         }
    //
    //                         // Add score to the chisel score grid
    //                         for (let i = 0; i < space.length; i++) {
    //                             for (let j = 0; j < space[i].length; j++) {
    //                                 if (space[i][j].value !== 0) {
    //                                     let mineSquareLevel = Mine.grid[i + y][j + x]();
    //
    //                                     gridScoresChisel[i + y][j + x] += (1 / Math.ceil(mineSquareLevel / 2)) / Underground.CHISEL_ENERGY;
    //                                 }
    //                             }
    //                         }
    //
    //                         // Commented out because it's always worse than chisel in practice so we don't waste time calculating it
    //                         // // Calculate hammer score grid for current item
    //                         // let gridBestScoresHammerForItem = new Array(Mine.grid.length).fill(0).map(() => new Array(Mine.grid[0].length).fill(0));
    //                         // for (let i = 0; i < space.length; i++) {
    //                         //     for (let j = 0; j < space[i].length; j++) {
    //                         //         if (space[i][j].value !== 0) {
    //                         //             let mineSquareLevel = Mine.grid[i + y][j + x]();
    //                         //             let curScore = (1 / mineSquareLevel) / Underground.HAMMER_ENERGY;
    //                         //
    //                         //             for (let k = -1; k < 2; k++) {
    //                         //                 for (let l = -1; l < 2; l++) {
    //                         //                     if (i + y + k > 0 && i + y + k < gridBestScoresHammerForItem.length - 1
    //                         //                         && j + x + l > 0 && j + x + l < gridBestScoresHammerForItem[i + y + k].length - 1
    //                         //                     ) {
    //                         //                         if (curScore > gridBestScoresHammerForItem[i + y + k][j + x + l]) {
    //                         //                             gridBestScoresHammerForItem[i + y + k][j + x + l] = curScore;
    //                         //                         }
    //                         //                     }
    //                         //                 }
    //                         //             }
    //                         //         }
    //                         //     }
    //                         // }
    //                         //
    //                         // // Add current item score grid to hammer score grid
    //                         // for (let i = 0; i < gridScoresHammer.length; i++) {
    //                         //     for (let j = 0; j < gridScoresHammer[i].length; j++) {
    //                         //         gridScoresHammer[i][j] += gridBestScoresHammerForItem[i][j];
    //                         //     }
    //                         // }
    //                     }
    //                 }
    //             }
    //         });
    //     } else {
    //         for (let y = 0; y < Mine.rewardGrid.length; ++y) {
    //             for (let x = 0; x < Mine.rewardGrid[y].length; ++x) {
    //                 if (Mine.rewardGrid[y][x] != 0) {
    //                     let mineSquareLevel = Mine.grid[y][x]();
    //
    //                     // Add score to chisel score grid
    //                     gridScoresChisel[y][x] += Math.min(mineSquareLevel, 2);
    //
    //                     // Add score to hammer score grid
    //                     for (let i = -1; i < 2; i++) {
    //                         for (let j = -1; j < 2; j++) {
    //                             if (y + i > 0 && y + i < gridScoresHammer.length - 1 && x + j > 0 && x + j < gridScoresHammer[y + i].length - 1) {
    //                                 gridScoresHammer[y + i][x + j] += Math.min(mineSquareLevel, 1) / Underground.HAMMER_ENERGY;
    //                             }
    //                         }
    //                     }
    //                 }
    //             }
    //         }
    //     }
    //
    //     // Select best case to break with chisel
    //     for (let i = 0; i < gridScoresChisel.length; ++i) {
    //         for (let j = 0; j < gridScoresChisel[i].length; ++j) {
    //             let score = gridScoresChisel[i][j];
    //             let mineSquareLevel = Mine.grid[i][j]();
    //
    //             if (score > 0 && mineSquareLevel > 0) {
    //                 // Used to discriminate between two equal scores
    //                 let distanceToCenter = Math.sqrt((i - centerI) * (i - centerI) + (j - centerJ) * (j - centerJ));
    //
    //                 if (score > bestScore || (score == bestScore && distanceToCenter < bestDistanceToCenter)) {
    //                     bestI = i;
    //                     bestJ = j;
    //                     bestToolToUse = Mine.Tool.Chisel;
    //                     bestScore = score;
    //                     bestDistanceToCenter = distanceToCenter;
    //                 }
    //             }
    //         }
    //     }
    //
    //     // Select best case to break with hammer
    //     for (let i = 0; i < gridScoresHammer.length; ++i) {
    //         for (let j = 0; j < gridScoresHammer[i].length; ++j) {
    //             let score = gridScoresHammer[i][j];
    //
    //             if (score > 0) {
    //                 // Used to discriminate between two equal scores
    //                 let distanceToCenter = Math.sqrt((i - centerI) * (i - centerI) + (j - centerJ) * (j - centerJ));
    //
    //                 if (score > bestScore || (score == bestScore && distanceToCenter < bestDistanceToCenter)) {
    //                     bestI = i;
    //                     bestJ = j;
    //                     bestToolToUse = Mine.Tool.Hammer;
    //                     bestScore = score;
    //                     bestDistanceToCenter = distanceToCenter;
    //                 }
    //             }
    //         }
    //     }
    //
    //     $(`div[data-i=${bestI}][data-j=${bestJ}]`).addClass('spot-to-break');
    //
    //     Mine.bestI = bestI;
    //     Mine.bestJ = bestJ;
    //     Mine.bestToolToUse = bestToolToUse;
    //     Mine.toolSelected(bestToolToUse);
    //
    //     return { bestI, bestJ, bestToolToUse, bestScore, bestDistanceToCenter };
    // }
}
