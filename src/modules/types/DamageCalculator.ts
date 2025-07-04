import PokemonType from '../enums/PokemonType';
import { Region } from '../GameConstants';
import WeatherType from '../weather/WeatherType';
import { getPokemonByName } from '../pokemons/PokemonHelper';
import GameHelper from '../GameHelper';
import type { TmpPartyPokemonType } from '../TemporaryScriptTypes';
import TypeHelper from './TypeHelper';

export default class DamageCalculator {
    public static type1 = ko.observable(PokemonType.None).extend({ numeric: 0 });
    public static type2 = ko.observable(PokemonType.None).extend({ numeric: 0 });
    public static region = ko.observable(Region.none);
    public static subregion = ko.observable(-1);
    public static weather = ko.observable(WeatherType.Clear);
    public static includeBreeding = ko.observable(false);
    public static baseAttackOnly = ko.observable(false);
    public static ignoreLevel = ko.observable(false);
    public static detailType = ko.observable(PokemonType.None).extend({ numeric: 0 });

    public static observableTypeDamageArray = ko.pureComputed(DamageCalculator.getDamageByTypes);
    public static observableTypeDetails = ko.pureComputed(DamageCalculator.getTypeDetail);
    public static observableTotalDamage = ko.pureComputed(DamageCalculator.totalDamage);

    public static initialize(): void {
        DamageCalculator.region.subscribe((value) => {
            const subregion = value == Region.none ? -1 : 0;
            DamageCalculator.subregion(subregion);
        });
    }

    public static totalDamage(): number {
        const ignoreRegionMultiplier = DamageCalculator.region() == Region.none;

        return App.game.party.calculatePokemonAttack(
            DamageCalculator.type1(),
            DamageCalculator.type2(),
            ignoreRegionMultiplier,
            DamageCalculator.region(),
            DamageCalculator.includeBreeding(),
            DamageCalculator.baseAttackOnly(),
            DamageCalculator.weather(),
            DamageCalculator.ignoreLevel(),
            true,
            DamageCalculator.subregion(),
        );
    }

    public static getDamageByTypes(): number[] {
        const typedamage = new Array(GameHelper.enumLength(PokemonType) - 1).fill(0);
        const ignoreRegionMultiplier = DamageCalculator.region() == Region.none;
        const activePokemon  = App.game.party.partyPokemonActiveInSubRegion(DamageCalculator.region(), DamageCalculator.subregion());

        for (const pokemon of activePokemon) {
            const dataPokemon = getPokemonByName(pokemon.name);
            if (dataPokemon.type1 === PokemonType.None) {
                continue;
            }

            const attack = App.game.party.calculateOnePokemonAttack(pokemon, PokemonType.None, PokemonType.None, DamageCalculator.region(), ignoreRegionMultiplier,
                DamageCalculator.includeBreeding(), DamageCalculator.baseAttackOnly(), DamageCalculator.weather(), DamageCalculator.ignoreLevel());

            if (DamageCalculator.type1() === PokemonType.None) {
                // When no defender type is selected, then we evenly split the pokemon's attack between its types
                typedamage[dataPokemon.type1] += attack / 2;
                const otherType = dataPokemon.type2 !== PokemonType.None ? dataPokemon.type2 : dataPokemon.type1;
                typedamage[otherType] += attack / 2;
            } else {
                // We calculate the base attack of the pokemon, and will affect the correct multiplier for each of its types, then we will only use the best multiplier
                const type1Multiplier = TypeHelper.getAttackModifier(dataPokemon.type1, PokemonType.None, DamageCalculator.type1(), DamageCalculator.type2());
                const type2Multiplier = dataPokemon.type2 !== PokemonType.None
                    ? TypeHelper.getAttackModifier(dataPokemon.type2, PokemonType.None, DamageCalculator.type1(), DamageCalculator.type2())
                    : -1;

                if (type1Multiplier > type2Multiplier) {
                    typedamage[dataPokemon.type1] += attack * type1Multiplier;
                } else if (type1Multiplier < type2Multiplier) {
                    typedamage[dataPokemon.type2] += attack * type2Multiplier;
                } else {
                    typedamage[dataPokemon.type1] += (attack / 2) * type1Multiplier;
                    typedamage[dataPokemon.type2] += (attack / 2) * type2Multiplier;
                }
            }
        }

        return typedamage;
    }

    // TODO replace temporary type with PartyPokemon type once that class is ported
    public static getOneTypeDetail(pokemon: TmpPartyPokemonType): TypeDetail {
        const ignoreRegionMultiplier = DamageCalculator.region() == Region.none;
        const dataPokemon = getPokemonByName(pokemon.name);

        let attack = App.game.party.calculateOnePokemonAttack(pokemon, PokemonType.None, PokemonType.None, DamageCalculator.region(), ignoreRegionMultiplier,
            DamageCalculator.includeBreeding(), DamageCalculator.baseAttackOnly(), DamageCalculator.weather(), DamageCalculator.ignoreLevel(), true, DamageCalculator.subregion());
        const type1Multiplier = TypeHelper.getAttackModifier(dataPokemon.type1, PokemonType.None, DamageCalculator.type1(), DamageCalculator.type2());
        const type2Multiplier = dataPokemon.type2 !== PokemonType.None
            ? TypeHelper.getAttackModifier(dataPokemon.type2, PokemonType.None, DamageCalculator.type1(), DamageCalculator.type2())
            : -1;
        let damage = 0;

        if (type1Multiplier > type2Multiplier && dataPokemon.type1 === DamageCalculator.detailType()) {
            damage = attack * type1Multiplier;
        } else if (type1Multiplier < type2Multiplier && dataPokemon.type2 === DamageCalculator.detailType()) {
            damage = attack * type2Multiplier;
        } else if (type1Multiplier === type2Multiplier && (dataPokemon.type1 === DamageCalculator.detailType() || dataPokemon.type2 === DamageCalculator.detailType())) {
            damage = (attack / 2) * type1Multiplier;
        }

        return {
            id: dataPokemon.id,
            name: dataPokemon.name,
            type1: dataPokemon.type1,
            type2: dataPokemon.type2,
            damage: damage,
            displayName: pokemon.displayName,
        };
    }

    public static getTypeDetail(): TypeDetail[] {
        return App.game.party.partyPokemonActiveInSubRegion(DamageCalculator.region(), DamageCalculator.subregion()).filter(pokemon => {
            const dataPokemon = getPokemonByName(pokemon.name);
            const type1Multiplier = TypeHelper.getAttackModifier(dataPokemon.type1, PokemonType.None, DamageCalculator.type1(), DamageCalculator.type2());
            const type2Multiplier = dataPokemon.type2 !== PokemonType.None
                ? TypeHelper.getAttackModifier(dataPokemon.type2, PokemonType.None, DamageCalculator.type1(), DamageCalculator.type2())
                : -1;

            return (dataPokemon.type1 == DamageCalculator.detailType() && type1Multiplier >= type2Multiplier && type1Multiplier > 0)
                || (dataPokemon.type2 == DamageCalculator.detailType() && type2Multiplier >= type1Multiplier && type2Multiplier > 0);
        }).reduce((details, pokemon) => {
            details.push(DamageCalculator.getOneTypeDetail(pokemon));
            return details;
        }, []).sort((a, b) => b.damage - a.damage);
    }
}

export type TypeDetail = {
    id: number,
    name: string,
    type1: PokemonType,
    type2: PokemonType,
    damage: number,
    displayName: string,
};

