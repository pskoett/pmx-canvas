export function createSteeringDeliveryPump({
    consumer,
    claim,
    send,
    mark,
    shouldSend = () => true,
    pause,
    onError,
    retryMs = 1_000,
}) {
    let stopped = false;
    let loopPromise = null;
    const awaitingMark = [];

    async function flushMarks() {
        while (awaitingMark.length > 0) {
            const id = awaitingMark[0];
            await mark(id, consumer);
            awaitingMark.shift();
        }
    }

    async function runOnce() {
        await flushMarks();
        const pending = await claim(consumer);
        for (const steering of pending) {
            if (stopped) break;
            if (shouldSend(steering)) await send(steering.message);
            awaitingMark.push(steering.id);
            await flushMarks();
        }
        return pending.length;
    }

    async function run() {
        while (!stopped) {
            try {
                const claimed = await runOnce();
                if (claimed === 0 && !stopped) await pause(retryMs);
            } catch (error) {
                onError(error);
                if (!stopped) await pause(retryMs);
            }
        }
    }

    return {
        runOnce,
        start() {
            if (!loopPromise) loopPromise = run();
            return loopPromise;
        },
        stop() {
            stopped = true;
        },
    };
}
