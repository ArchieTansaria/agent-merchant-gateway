import re

with open("/Users/archietans/Developer/projects/agent-merchant-gateway/src/main.ts", "r") as f:
    content = f.read()

# I see that renderWorkflow has two versions now, one old (around 865) and one new (around 825).
# I'll just remove the old one entirely.

# Let's find the old one: `function renderWorkflow(run: ImprovementRun): string {`
old_render_workflow = re.search(r'function renderWorkflow\(run: ImprovementRun\): string \{.*?\n\}', content, re.DOTALL)
if old_render_workflow:
    content = content[:old_render_workflow.start()] + content[old_render_workflow.end():]

# Let's fix the extra junk at line 880:
content = re.sub(r'\}">\$\{(.*?)\}\n\}', r'}', content, flags=re.DOTALL)

with open("/Users/archietans/Developer/projects/agent-merchant-gateway/src/main.ts", "w") as f:
    f.write(content)
print("Done")
