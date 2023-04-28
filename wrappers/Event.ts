import { compileFunc } from '@ton-community/func-js';
import TonConnect from '@tonconnect/sdk';
import { readdirSync, readFileSync } from 'fs';
import { TonClient } from 'ton';
import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    Sender,
    toNano,
    TupleItem,
} from 'ton-core';
import { storeStateInit } from 'ton-core/dist/types/StateInit';
import { ContractExecutor, ContractSystem } from 'ton-emulator';

import { Bet } from './Bet';
import path from 'path';

export class Event implements Contract {
    readonly address: Address;
    readonly init: { code: Cell; data: Cell };
    readonly executor?: ContractExecutor;
    readonly client?: TonClient;

    constructor(
        address: Address,
        init: { code: Cell; data: Cell },
        executor: ContractExecutor | TonClient
    ) {
        this.address = address;
        this.init = init;
        if ('get' in executor) {
            this.executor = executor;
        } else {
            this.client = executor;
        }
    }

    async getBetAddress(better: Address, outcome: boolean) {
        let stateInit = beginCell()
            .storeUint(6, 5)
            .storeRef(await Bet.getCode())
            .storeRef(
                beginCell()
                    .storeAddress(better)
                    .storeAddress(this.address)
                    .storeBit(outcome)
                    .storeUint(0, 256)
                    .endCell()
            )
            .endCell();
        return new Address(0, stateInit.hash());
    }

    static async create(
        system: ContractSystem | TonClient,
        oracle: Address,
        uid: number
    ): Promise<Event> {
        const stateInit = await this.getStateInit(oracle, uid);
        const address = contractAddress(0, stateInit);
        if ('contract' in system) {
            return new Event(address, stateInit, system.contract(address));
        }
        return new Event(address, stateInit, system);
    }

    async deploy(via: Sender | TonConnect) {
        if ('sendTransaction' in via) {
            await via.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 600,
                messages: [
                    {
                        address: this.address.toRawString(),
                        amount: toNano('0.05').toString(),
                        stateInit: beginCell()
                            .store(storeStateInit(this.init))
                            .endCell()
                            .toBoc()
                            .toString('base64'),
                    },
                ],
            });
        } else {
            await via.send({
                to: this.address,
                init: this.init,
                value: toNano('0.05'),
            });
        }
    }

    async bet(
        via: Sender | TonConnect,
        outcome: boolean,
        amount: bigint
    ): Promise<Bet> {
        let betAddress: Address;
        if ('sendTransaction' in via) {
            betAddress = await this.getBetAddress(
                Address.parse(via.wallet!.account.address),
                outcome
            );
            await via.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 600,
                messages: [
                    {
                        address: this.address.toString(),
                        amount: (toNano('0.05') + amount).toString(),
                        stateInit: beginCell()
                            .store(storeStateInit(this.init))
                            .endCell()
                            .toBoc()
                            .toString('base64'),
                        payload: beginCell()
                            .storeUint(0x60e6b243, 32)
                            .storeBit(outcome)
                            .storeUint(amount, 256)
                            .endCell()
                            .toBoc()
                            .toString('base64'),
                    },
                ],
            });
        } else {
            betAddress = await this.getBetAddress(via.address!, outcome);
            await via.send({
                to: this.address,
                init: this.init,
                value: toNano('0.05') + toNano(amount.toString()),
                body: beginCell()
                    .storeUint(0x60e6b243, 32)
                    .storeBit(outcome)
                    .storeUint(toNano(amount.toString()), 256)
                    .endCell(),
            });
        }

        return new Bet(betAddress, (this.executor || this.client)!);
    }

    async startEvent(via: Sender | TonConnect) {
        if ('sendTransaction' in via) {
            await via.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 600,
                messages: [
                    {
                        address: this.address.toRawString(),
                        amount: toNano('0.05').toString(),
                        stateInit: beginCell()
                            .store(storeStateInit(this.init))
                            .endCell()
                            .toBoc()
                            .toString('base64'),
                        payload: beginCell()
                            .storeUint(0x380ce405, 32)
                            .endCell()
                            .toBoc()
                            .toString('base64'),
                    },
                ],
            });
        } else {
            await via.send({
                to: this.address,
                init: this.init,
                value: toNano('0.05'),
                body: beginCell().storeUint(0x380ce405, 32).endCell(),
            });
        }
    }

    /*
        0b00 (0) - winnerA
        0b01 (1) - winnerB
        0b11 (3) - draw
    */
    async finishEvent(via: Sender | TonConnect, winner: number) {
        if ('sendTransaction' in via) {
            await via.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 600,
                messages: [
                    {
                        address: this.address.toRawString(),
                        amount: toNano('0.05').toString(),
                        stateInit: beginCell()
                            .store(storeStateInit(this.init))
                            .endCell()
                            .toBoc()
                            .toString('base64'),
                        payload: beginCell()
                            .storeUint(0x54a94f2a, 32)
                            .storeUint(winner, 2)
                            .endCell()
                            .toBoc()
                            .toString('base64'),
                    },
                ],
            });
        } else {
            await via.send({
                to: this.address,
                init: this.init,
                value: toNano('0.05'),
                body: beginCell()
                    .storeUint(0x3f551084, 32)
                    .storeUint(winner, 2)
                    .endCell(),
            });
        }
    }

    private async runGetMethod(
        method: string,
        stack?: TupleItem[] | undefined
    ) {
        var res;
        if (this.executor) {
            res = await this.executor.get(method);
            if (!res.success) throw res.error;
        } else {
            res = await this.client!.callGetMethod(this.address, method, stack);
        }
        return res.stack;
    }

    async getTotalBets() {
        const t = await this.runGetMethod('get_total_bets');
        return [t.readBigNumber(), t.readBigNumber()];
    }

    async getStartedFinished() {
        const t = await this.runGetMethod('get_started_finished');
        return [t.readBoolean(), t.readBoolean()];
    }

    async getWinner() {
        return (await this.runGetMethod('get_winner')).readBoolean();
    }

    static async getCode(): Promise<Cell> {
        let result = await compileFunc({
            targets: ['stdlib.fc', 'opcodes.fc', 'event.fc'],
            sources: (target) =>
                readFileSync(
                    path.join(__dirname, '..', 'func/') + target
                ).toString(),
        });
        if (result.status === 'error') {
            throw result.message;
        }
        return Cell.fromBoc(Buffer.from(result.codeBoc, 'base64'))[0];
    }

    static async getStateInit(
        oracle: Address,
        uid: number
    ): Promise<{ code: Cell; data: Cell }> {
        return {
            code: await this.getCode(),
            data: beginCell()
                .storeUint(uid, 128)
                .storeAddress(oracle)
                .storeUint(0, 516)
                .storeRef(await Bet.getCode())
                .endCell(),
        };
    }

    static async getContractAddress(
        oracle: Address,
        uid: number
    ): Promise<Address> {
        const stateInit = await this.getStateInit(oracle, uid);
        const address = contractAddress(0, stateInit);
        return address;
    }

    // retrieve existing contract from blockchain
    static async getInstance(
        client: TonClient,
        address: Address
    ): Promise<Event> {
        const contractState = await client.getContractState(address);
        if (!contractState || !contractState.code || !contractState.data)
            throw new Error('Contract not found');
        const init = {
            code: Cell.fromBoc(contractState.code)[0],
            data: Cell.fromBoc(contractState.data)[0],
        };
        const contract = new Event(address, init, client);
        return new Event(contract.address, contract.init, client);
    }
}
function cell_hash(state_init: any): any {
    throw new Error('Function not implemented.');
}
