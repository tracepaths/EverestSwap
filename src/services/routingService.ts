// ── Multi-Hop Routing Service for EverestSwap ─────────────────────────────
// Finds optimal swap routes across multiple pools to minimize price impact

import { OctraRpc } from './octraRpc';

export interface Route {
  path: string[];
  pools: string[];
  estimatedOutput: bigint;
  priceImpact: number;
}

export interface RouteResult {
  bestRoute: Route | null;
  allRoutes: Route[];
  error?: string;
}

/**
 * Find the best route for a swap between two tokens
 * Uses BFS to explore possible paths through the pool graph
 */
export async function findBestRoute(
  rpc: OctraRpc,
  factoryAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  maxHops: number = 3
): Promise<RouteResult> {
  const allRoutes: Route[] = [];
  
  try {
    // Get all pools from factory
    const poolAddresses = await rpc.call<string[]>('contract_call', [
      factoryAddress,
      'all_pools',
      []
    ]);
    
    if (!poolAddresses || poolAddresses.length === 0) {
      return { bestRoute: null, allRoutes: [], error: 'No pools found' };
    }
    
    // Build adjacency graph from pools
    const graph = new Map<string, Set<string>>();
    const poolMap = new Map<string, string>(); // "tokenA:tokenB" -> poolAddress
    
    for (const poolAddr of poolAddresses) {
      try {
        const [tokenA, tokenB] = await Promise.all([
          rpc.call<string>('contract_call', [poolAddr, 'get_token_a', []]),
          rpc.call<string>('contract_call', [poolAddr, 'get_token_b', []])
        ]);
        
        if (tokenA && tokenB) {
          // Add edges to graph
          if (!graph.has(tokenA)) graph.set(tokenA, new Set());
          if (!graph.has(tokenB)) graph.set(tokenB, new Set());
          graph.get(tokenA)!.add(tokenB);
          graph.get(tokenB)!.add(tokenA);
          
          // Store pool mapping
          poolMap.set(`${tokenA}:${tokenB}`, poolAddr);
          poolMap.set(`${tokenB}:${tokenA}`, poolAddr);
        }
      } catch {
        // Skip invalid pools
      }
    }
    
    // BFS to find all paths up to maxHops
    const paths = findPaths(graph, tokenIn, tokenOut, maxHops);
    
    // Evaluate each path
    for (const path of paths) {
      const route = await evaluateRoute(rpc, poolMap, path, amountIn);
      if (route) {
        allRoutes.push(route);
      }
    }
    
    // Sort by estimated output (highest first)
    allRoutes.sort((a, b) => Number(b.estimatedOutput - a.estimatedOutput));
    
    return {
      bestRoute: allRoutes[0] || null,
      allRoutes
    };
    
  } catch (e) {
    return {
      bestRoute: null,
      allRoutes: [],
      error: `Routing error: ${(e as Error).message}`
    };
  }
}

/**
 * Find all paths from start to end using BFS
 */
function findPaths(
  graph: Map<string, Set<string>>,
  start: string,
  end: string,
  maxHops: number
): string[][] {
  const paths: string[][] = [];
  const queue: { node: string; path: string[] }[] = [{ node: start, path: [start] }];
  
  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    
    if (node === end && path.length > 1) {
      paths.push(path);
      continue;
    }
    
    if (path.length > maxHops + 1) {
      continue;
    }
    
    const neighbors = graph.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (!path.includes(neighbor)) {
        queue.push({ node: neighbor, path: [...path, neighbor] });
      }
    }
  }
  
  return paths;
}

/**
 * Evaluate a route and calculate estimated output
 */
async function evaluateRoute(
  rpc: OctraRpc,
  poolMap: Map<string, string>,
  path: string[],
  amountIn: bigint
): Promise<Route | null> {
  try {
    let currentAmount = amountIn;
    const pools: string[] = [];
    
    for (let i = 0; i < path.length - 1; i++) {
      const poolKey = `${path[i]}:${path[i + 1]}`;
      const poolAddr = poolMap.get(poolKey);
      
      if (!poolAddr) {
        return null; // No pool for this pair
      }
      
      pools.push(poolAddr);
      
      // Get amount out from pool
      const isAToB = path[i] < path[i + 1];
      const output = await rpc.call<string>('contract_call', [
        poolAddr,
        'get_amount_out',
        [currentAmount.toString(), isAToB ? 1 : 0]
      ]);
      
      currentAmount = BigInt(output || '0');
      
      if (currentAmount === 0n) {
        return null; // Zero output
      }
    }
    
    // Calculate price impact
    const priceImpact = Number(amountIn - currentAmount) / Number(amountIn) * 100;
    
    return {
      path,
      pools,
      estimatedOutput: currentAmount,
      priceImpact
    };
    
  } catch {
    return null;
  }
}

/**
 * Calculate multi-hop output for a given path
 */
export async function calculateMultiHopOutput(
  rpc: OctraRpc,
  poolMap: Map<string, string>,
  path: string[],
  amountIn: bigint
): Promise<bigint> {
  let currentAmount = amountIn;
  
  for (let i = 0; i < path.length - 1; i++) {
    const poolKey = `${path[i]}:${path[i + 1]}`;
    const poolAddr = poolMap.get(poolKey);
    
    if (!poolAddr) {
      return 0n;
    }
    
    const isAToB = path[i] < path[i + 1];
    const output = await rpc.call<string>('contract_call', [
      poolAddr,
      'get_amount_out',
      [currentAmount.toString(), isAToB ? 1 : 0]
    ]);
    
    currentAmount = BigInt(output || '0');
  }
  
  return currentAmount;
}

/**
 * Get route display string
 */
export function formatRoute(route: Route, symbolMap: Map<string, string>): string {
  return route.path
    .map(addr => symbolMap.get(addr) || addr.slice(0, 8))
    .join(' → ');
}
