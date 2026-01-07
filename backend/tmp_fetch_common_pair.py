import urllib.request, urllib.parse, json
params = urllib.parse.urlencode({'a':'@I10@','b':'@I1@'})
url = f'http://localhost:8000/api/common_pair?{params}'
with urllib.request.urlopen(url) as r:
    data = json.load(r)
print(json.dumps(data, indent=2))
