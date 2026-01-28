import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Trash2, Sparkles, Check, X, RotateCcw, List, Network } from "lucide-react";
import { useState, useCallback, useMemo, useEffect } from "react";
import { ReactFlow, Background, Controls, useNodesState, useEdgesState, Position, Handle, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { orpc } from "@/utils/orpc";
import type { MindMapNode } from "@orpc-test/api/routers/ai";

export const Route = createFileRoute("/todos")({
  component: TodosRoute,
});

// Custom Node Component
const MindMapNodeComponent = ({ data, selected }: { data: { label: string, onCheck?: (checked: boolean) => void, checked?: boolean, isExisting?: boolean, completed?: boolean }, selected: boolean }) => {
  return (
    <div className={`px-4 py-2 shadow-md rounded-md bg-white dark:bg-slate-800 border-2 min-w-[150px] ${selected || (data.checked !== false) ? 'border-primary' : 'border-gray-200 dark:border-gray-700'}`}>
      <Handle type="target" position={Position.Top} className="w-16 !bg-gray-400" />
      <div className="flex items-center">
        {data.isExisting ? (
             <div className={`text-sm font-medium ${data.completed ? 'line-through text-muted-foreground' : ''}`}>{data.label}</div>
        ) : (
            <>
                <Checkbox 
                    checked={data.checked}
                    onCheckedChange={(c) => data.onCheck?.(!!c)}
                    className="mr-2"
                />
                <div className="text-sm font-medium">{data.label}</div>
            </>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-16 !bg-gray-400" />
    </div>
  );
};

const nodeTypes = {
  mindMap: MindMapNodeComponent,
};

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    const nodeWidth = 180;
    const nodeHeight = 50;

    dagreGraph.setGraph({ rankdir: 'TB' });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        return {
            ...node,
            position: {
                x: nodeWithPosition.x - nodeWidth / 2,
                y: nodeWithPosition.y - nodeHeight / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
};


function TodosRoute() {
  const [newTodoText, setNewTodoText] = useState("");
  const [isSmartMode, setIsSmartMode] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'mindmap'>('list');
  const [smartGoal, setSmartGoal] = useState("");
  const [generatedRoot, setGeneratedRoot] = useState<MindMapNode | null>(null);
  
  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());

  const todos = useQuery(orpc.todo.getAll.queryOptions());
  
  // Update graph when switching to mindmap view with existing todos
  useEffect(() => {
    if (viewMode === 'mindmap' && !isSmartMode && todos.data) {
        const newNodes: Node[] = [];
        const newEdges: Edge[] = [];
        
        // Root node
        newNodes.push({
            id: 'root',
            type: 'mindMap',
            data: { label: 'My Tasks', isExisting: true },
            position: { x: 0, y: 0 }
        });

        todos.data.forEach((todo, index) => {
            const nodeId = `todo-${todo.id}`;
            newNodes.push({
                id: nodeId,
                type: 'mindMap',
                data: { 
                    label: todo.text, 
                    isExisting: true,
                    completed: todo.completed
                },
                position: { x: 0, y: 0 }
            });
            newEdges.push({
                id: `e-root-${nodeId}`,
                source: 'root',
                target: nodeId,
                type: 'smoothstep',
                animated: true
            });
        });

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(newNodes, newEdges);
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
    }
  }, [viewMode, isSmartMode, todos.data, setNodes, setEdges]);


  const createMutation = useMutation(
    orpc.todo.create.mutationOptions({
      onSuccess: () => {
        todos.refetch();
        setNewTodoText("");
      },
    }),
  );
  const toggleMutation = useMutation(
    orpc.todo.toggle.mutationOptions({
      onSuccess: () => {
        todos.refetch();
      },
    }),
  );
  const deleteMutation = useMutation(
    orpc.todo.delete.mutationOptions({
      onSuccess: () => {
        todos.refetch();
      },
    }),
  );

  const generatePlanMutation = useMutation(
    orpc.ai.generatePlan.mutationOptions({
        onSuccess: (rootNode) => {
            setGeneratedRoot(rootNode);
            
            // Transform to React Flow
            const newNodes: Node[] = [];
            const newEdges: Edge[] = [];
            const initialSelection = new Set<string>();

            const traverse = (node: MindMapNode, parentId?: string) => {
                const nodeId = node.id || Math.random().toString(36).substr(2, 9);
                
                // Add node
                newNodes.push({
                    id: nodeId,
                    type: 'mindMap',
                    data: { 
                        label: node.label,
                        checked: true, // Default checked
                        // We will inject the handler later via map to keep it fresh
                    },
                    position: { x: 0, y: 0 }, // Will be set by dagre
                });

                initialSelection.add(node.label);

                if (parentId) {
                    newEdges.push({
                        id: `e${parentId}-${nodeId}`,
                        source: parentId,
                        target: nodeId,
                        type: 'smoothstep',
                        animated: true,
                    });
                }

                if (node.children) {
                    node.children.forEach(child => traverse(child, nodeId));
                }
            };

            traverse(rootNode);
            setSelectedTasks(initialSelection);

            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(newNodes, newEdges);
            setNodes(layoutedNodes);
            setEdges(layoutedEdges);
        }
    })
  );

  // Update nodes when selection changes
  const updateNodeSelection = useCallback((label: string, checked: boolean) => {
    setSelectedTasks(prev => {
        const next = new Set(prev);
        if (checked) next.add(label);
        else next.delete(label);
        return next;
    });

    setNodes(nds => nds.map(node => {
        if (node.data.label === label) {
            return {
                ...node,
                data: {
                    ...node.data,
                    checked: checked
                }
            };
        }
        return node;
    }));
  }, [setNodes]);

  // Inject handlers into nodes (only for smart mode)
  const nodesWithHandlers = useMemo(() => {
    if (!isSmartMode && viewMode === 'mindmap') return nodes;

    return nodes.map(node => ({
        ...node,
        data: {
            ...node.data,
            onCheck: (c: boolean) => updateNodeSelection(node.data.label as string, c),
            checked: selectedTasks.has(node.data.label as string)
        }
    }));
  }, [nodes, selectedTasks, updateNodeSelection, isSmartMode, viewMode]);


  const handleAddTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTodoText.trim()) {
      createMutation.mutate({ text: newTodoText });
    }
  };

  const handleSmartAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (smartGoal.trim()) {
        generatePlanMutation.mutate({ goal: smartGoal });
    }
  };

  const confirmSmartAdd = async () => {
    // Flatten the tree and filter by selection
    const tasksToAdd = Array.from(selectedTasks);
    
    // Execute sequentially to ensure order
    for (const task of tasksToAdd) {
        await createMutation.mutateAsync({ text: task });
    }
    // Reset
    setIsSmartMode(false);
    setSmartGoal("");
    setGeneratedRoot(null);
    setNodes([]);
    setEdges([]);
    setViewMode('list'); // Switch back to list view to see added items
  };

  const handleToggleTodo = (id: number, completed: boolean) => {
    toggleMutation.mutate({ id, completed: !completed });
  };

  const handleDeleteTodo = (id: number) => {
    deleteMutation.mutate({ id });
  };

  return (
    <div className="mx-auto w-full max-w-4xl py-12 px-4">
      <Card className="shadow-lg border-muted/60">
        <CardHeader className="pb-4">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
                <CardTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">Todo List</CardTitle>
                <CardDescription>Manage your tasks efficiently</CardDescription>
            </div>
            <div className="flex gap-2">
                {!isSmartMode && (
                    <div className="flex bg-muted rounded-lg p-1">
                        <Button 
                            variant={viewMode === 'list' ? 'secondary' : 'ghost'} 
                            size="sm" 
                            className="h-8 px-2"
                            onClick={() => setViewMode('list')}
                        >
                            <List className="h-4 w-4 mr-1" /> List
                        </Button>
                        <Button 
                            variant={viewMode === 'mindmap' ? 'secondary' : 'ghost'} 
                            size="sm" 
                            className="h-8 px-2"
                            onClick={() => setViewMode('mindmap')}
                        >
                            <Network className="h-4 w-4 mr-1" /> Graph
                        </Button>
                    </div>
                )}
                <Button 
                    variant={isSmartMode ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => {
                        setIsSmartMode(!isSmartMode);
                        setGeneratedRoot(null);
                        setSmartGoal("");
                        if (!isSmartMode) {
                            setViewMode('list'); // Force list view context for smart add (it has its own graph)
                        }
                    }}
                    className={`gap-2 transition-all duration-300 ${isSmartMode ? "bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20 dark:text-yellow-400" : "text-muted-foreground hover:text-primary"}`}
                >
                    <Sparkles className={`h-4 w-4 ${isSmartMode ? "text-yellow-500 fill-yellow-500" : ""}`} />
                    {isSmartMode ? "Smart Mode" : "Smart Add"}
                </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isSmartMode ? (
              <div className="space-y-4 mb-6 p-5 border rounded-xl bg-muted/30 animate-in fade-in slide-in-from-top-2 duration-300">
                  {!generatedRoot ? (
                      <form onSubmit={handleSmartAdd} className="space-y-3">
                          <label className="text-sm font-medium">What's your goal?</label>
                          <textarea 
                            name="goal"
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                            placeholder="e.g. Plan a 3-day trip to Tokyo…"
                            value={smartGoal}
                            onChange={(e) => setSmartGoal(e.target.value)}
                            disabled={generatePlanMutation.isPending}
                          />
                          <Button type="submit" className="w-full" disabled={generatePlanMutation.isPending || !smartGoal.trim()}>
                              {generatePlanMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                              Generate Plan
                          </Button>
                      </form>
                  ) : (
                      <div className="space-y-3">
                          <div className="flex justify-between items-center">
                              <h4 className="font-medium text-sm">Suggested Mind Map</h4>
                              <div className="flex gap-2">
                                <Button variant="ghost" size="sm" onClick={() => {
                                    setGeneratedRoot(null);
                                    setNodes([]);
                                }} aria-label="Reset">
                                    <RotateCcw className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => {
                                    setIsSmartMode(false);
                                    setGeneratedRoot(null);
                                }} aria-label="Close suggestions"><X className="h-4 w-4" /></Button>
                              </div>
                          </div>
                          
                          {/* Mind Map Canvas */}
                          <div className="h-[400px] border rounded-lg bg-slate-50 dark:bg-slate-900/50 relative">
                            <ReactFlow
                                nodes={nodesWithHandlers}
                                edges={edges}
                                onNodesChange={onNodesChange}
                                onEdgesChange={onEdgesChange}
                                nodeTypes={nodeTypes}
                                fitView
                            >
                                <Background color="#ccc" gap={20} size={1} />
                                <Controls />
                            </ReactFlow>
                          </div>

                          <div className="flex gap-2 pt-2">
                              <Button variant="outline" className="flex-1" onClick={() => setGeneratedRoot(null)}>Cancel</Button>
                              <Button className="flex-1" onClick={confirmSmartAdd} disabled={createMutation.isPending}>
                                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                                  Add Selected ({selectedTasks.size})
                              </Button>
                          </div>
                      </div>
                  )}
              </div>
          ) : (
            <>
                {viewMode === 'list' ? (
                    <>
                        <form onSubmit={handleAddTodo} className="mb-6 flex items-center space-x-2">
                            <Input
                                name="text"
                                value={newTodoText}
                                onChange={(e) => setNewTodoText(e.target.value)}
                                placeholder="Add a new task…"
                                disabled={createMutation.isPending}
                                className="flex-1"
                            />
                            <Button type="submit" disabled={createMutation.isPending || !newTodoText.trim()}>
                            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                            </Button>
                        </form>

                        {todos.isLoading ? (
                            <div className="flex justify-center py-4">
                            <Loader2 className="h-6 w-6 animate-spin" />
                            </div>
                        ) : todos.data?.length === 0 ? (
                            <p className="py-4 text-center text-muted-foreground text-sm">No todos yet. Try Smart Add to get started!</p>
                        ) : (
                            <ul className="space-y-2">
                            {todos.data?.map((todo) => (
                                <li
                                key={todo.id}
                                className="group flex items-center justify-between rounded-lg border border-transparent bg-card p-3 shadow-sm transition-all hover:border-border hover:shadow-md"
                                >
                                <div className="flex items-center space-x-3">
                                    <Checkbox
                                    checked={todo.completed}
                                    onCheckedChange={() => handleToggleTodo(todo.id, todo.completed)}
                                    id={`todo-${todo.id}`}
                                    className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                    />
                                    <label
                                    htmlFor={`todo-${todo.id}`}
                                    className={`text-sm font-medium transition-colors ${todo.completed ? "line-through text-muted-foreground/50" : "text-foreground"}`}
                                    >
                                    {todo.text}
                                    </label>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteTodo(todo.id)}
                                    aria-label="Delete todo"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                                </li>
                            ))}
                            </ul>
                        )}
                    </>
                ) : (
                    <div className="h-[500px] border rounded-lg bg-slate-50 dark:bg-slate-900/50 relative">
                         {todos.isLoading ? (
                            <div className="flex h-full items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin" />
                            </div>
                        ) : todos.data?.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-muted-foreground">
                                No tasks to visualize
                            </div>
                        ) : (
                            <ReactFlow
                                nodes={nodesWithHandlers}
                                edges={edges}
                                onNodesChange={onNodesChange}
                                onEdgesChange={onEdgesChange}
                                nodeTypes={nodeTypes}
                                fitView
                            >
                                <Background color="#ccc" gap={20} size={1} />
                                <Controls />
                            </ReactFlow>
                        )}
                    </div>
                )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
