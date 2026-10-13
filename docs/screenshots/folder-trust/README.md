# Folder-trust regression evidence

These images render actual Node test output from the same isolated regression. Before: the main implementation (unchanged by the renderer-only Teams/Graph branch) drops a saved worker trust decision during hook reinstallation. After: the folder-trust fix preserves it through three installations, preserves an explicit refusal, refreshes global settings without duplicating hooks, and respects an explicit global override. The regression uses temporary homes and a path containing spaces. No personal folder decisions or configuration files are included.
