/* eslint-env browser */
/* eslint-disable no-console */

'use strict';


const yaml = require('js-yaml');

const { Template, guiUtils } = require('@f5devcentral/fast');

const endPointUrl = '/mgmt/shared/fast';

const getJSON = endPoint => fetch(`${endPointUrl}/${endPoint}`).then((data) => {
    if (!data.ok) {
        throw new Error(`Failed to get data from ${endPointUrl}/${endPoint}: ${data.status} ${data.statusText}`);
    }
    return data.json();
});

let editor = null;

let outputElem;

const dispOutput = (output) => {
    console.log(output);
    if (outputElem) {
        outputElem.innerText = output;
    }
};

const multipartUpload = (file) => {
    const CHUNK_SIZE = 1000000;
    const uploadPart = (start, end) => {
        const opts = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Range': `${start}-${end}/${file.size}`,
                'Content-Length': (end - start) + 1,
                Connection: 'keep-alive'
            },
            body: file.slice(start, end + 1, 'application/octet-stream')
        };
        return fetch(`/mgmt/shared/file-transfer/uploads/${file.name}`, opts)
            .then((response) => {
                if (!response.ok) {
                    return Promise.reject(new Error(`Failed to upload file: ${JSON.stringify(response)}`));
                }
                return Promise.resolve();
            })
            .then(() => {
                if (end === file.size - 1) {
                    return Promise.resolve();
                }
                const nextStart = start + CHUNK_SIZE;
                const nextEnd = (end + CHUNK_SIZE > file.size - 1) ? file.size - 1 : end + CHUNK_SIZE;
                return uploadPart(nextStart, nextEnd);
            });
    };

    if (CHUNK_SIZE < file.size) {
        return uploadPart(0, CHUNK_SIZE - 1);
    }
    return uploadPart(0, file.size - 1);
};


const newEditor = (tmplid, view) => {
    const formElement = document.getElementById('form-div');
    if (editor) {
        editor.destroy();
    }

    dispOutput(`Loading template: ${tmplid}`);
    getJSON(`templates/${tmplid}`)
        .then((data) => {
            if (data.code) {
                return Promise.reject(new Error(`Error loading template "${tmplid}":\n${data.message}`));
            }
            return Template.fromJson(data);
        })
        .then((tmpl) => {
            const schema = JSON.parse(JSON.stringify(tmpl.getViewSchema())); // Deep copy schema before modifying
            dispOutput(`Creating editor with schema:\n${JSON.stringify(schema, null, 2)}`);

            // Prep the schema for JSON editor
            guiUtils.modSchemaForJSONEditor(schema);
            dispOutput(`Schema modified for the editor:\n${JSON.stringify(schema, null, 2)}`);

            // Create a new editor
            const defaults = guiUtils.filterExtraProperties(tmpl.getCombinedView(view), schema);
            // eslint-disable-next-line no-undef
            editor = new JSONEditor(formElement, {
                schema,
                startval: defaults,
                compact: true,
                show_errors: 'always',
                disable_edit_json: true,
                disable_properties: true,
                disable_collapse: true,
                array_controls_top: true,
                theme: 'spectre',
                iconlib: 'fontawesome5'
            });
            dispOutput('Editor loaded'); // Clear text on new editor load

            editor.on('ready', () => {
                dispOutput('Editor ready');

                // Enable form button now that the form is ready
                document.getElementById('view-tmpl-btn').disabled = false;
                document.getElementById('view-schema-btn').disabled = false;
                document.getElementById('view-view-btn').disabled = false;
                document.getElementById('view-render-btn').disabled = false;
                document.getElementById('form-btn').disabled = false;
            });

            editor.on('change', () => {
                document.getElementById('form-btn').disabled = editor.validation_results.length !== 0;
            });

            // Hook up buttons
            document.getElementById('view-tmpl-btn').onclick = () => {
                dispOutput(tmpl.templateText);
            };
            document.getElementById('view-schema-btn').onclick = () => {
                dispOutput(JSON.stringify(schema, null, 2));
            };
            document.getElementById('view-view-btn').onclick = () => {
                dispOutput(JSON.stringify(tmpl.getCombinedView(editor.getValue()), null, 2));
            };
            document.getElementById('view-render-btn').onclick = () => {
                dispOutput(JSON.stringify(yaml.safeLoad(tmpl.render(editor.getValue())), null, 2));
            };
            document.getElementById('form-btn').onclick = () => {
                const data = {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: tmplid,
                        parameters: editor.getValue()
                    })
                };
                dispOutput(JSON.stringify(data, null, 2));
                fetch(`${endPointUrl}/applications`, data)
                    .then(response => response.json())
                    .then((result) => {
                        dispOutput(JSON.stringify(result, null, 2));
                    })
                    .then(() => {
                        window.location.href = '#tasks';
                    });
            };
        })
        .catch(e => dispOutput(`Error loading editor:\n${e.message}`));
};

// Setup basic routing

const routes = {};
function route(path, pageName, pageFunc) {
    routes[path] = { pageName, pageFunc };
}

const navTitles = {};
function addRouteToHeader(topRoute, title) {
    navTitles[topRoute] = title;
    return title;
}

function router() {
    const rawUrl = window.location.hash.slice(1) || '';
    const url = rawUrl.replace(/\/application.*?\/edit/, '');
    const urlParts = url.split('/');
    const routeInfo = routes[urlParts[0]];

    // render header menu
    const navBar = document.getElementById('navBar');
    const navBarDisplay = navBar.style.display;
    navBar.innerHTML = '';

    Object.keys(navTitles).forEach((k) => {
        let d;
        if (k !== urlParts[0]) {
            d = document.createElement('a');
            d.classList.add('btn-nav');
            d.classList.add('btn');
            d.href = `#${k}`;
        } else {
            d = document.createElement('div');
            d.classList.add('selected-nav');
        }
        d.innerText = navTitles[k];
        navBar.appendChild(d);
    });

    // render app
    const elem = document.getElementById('app');

    // Remove old content
    while (elem.firstChild) {
        elem.firstChild.remove();
    }

    // Error on unknown route
    if (!routeInfo) {
        const msg = `Could not find route info for url: ${url} (raw was ${rawUrl}, routes: ${Object.keys(routes).join(',')})`;
        elem.innerText = msg;
        console.error(msg);
        return;
    }

    // Load new page
    const pageId = `#page-${routeInfo.pageName}`;
    const pageTmpl = document.querySelector(pageId);
    elem.appendChild(document.importNode(pageTmpl.content, true));
    elem.style.display = 'none';
    navBar.style.display = 'none';

    const pageFunc = routeInfo.pageFunc || (() => Promise.resolve());
    pageFunc(urlParts.slice(1).join('/'))
        .finally(() => {
            elem.style.display = 'block';
            navBar.style.display = navBarDisplay;
        });
}

window.addEventListener('hashchange', router);
window.addEventListener('load', router);


// tabbed navigation menu items
addRouteToHeader('', 'Application List');
addRouteToHeader('create', 'Deploy');
addRouteToHeader('templates', 'Templates');
addRouteToHeader('tasks', 'Deploy Log');
addRouteToHeader('api', 'API');

// Define routes
route('', 'apps', () => {
    outputElem = document.getElementById('output');
    const listElem = document.getElementById('applist');
    let count = 0;
    let lastTenant = '';
    dispOutput('Fetching applications list');
    return getJSON('applications')
        .then((appsList) => {
            listElem.innerHTML = `<div class="appListRow">
              <div class="appListTitle">Tenant</div>
              <div class="appListTitle">Application</div>
              <div class="appListTitle">Template</div>
              <div class="appListEntry"></div>
              <div class="appListEntry"></div>
            </div>`;
            appsList.forEach((app) => {
                const appPair = [app.tenant, app.name];
                const appPairStr = `${appPair.join('/')}`;

                const row = document.createElement('div');
                row.classList.add('appListRow');
                count += 1;
                if (count % 2) row.classList.add('zebraRow');

                const appTenant = document.createElement('div');
                if (appPair[0] !== lastTenant) {
                    const divider = document.createElement('hr');
                    if (count % 2) divider.classList.add('zebraRow');
                    listElem.appendChild(divider);
                    appTenant.innerText = appPair[0];
                    lastTenant = appPair[0];
                }
                appTenant.classList.add('appListTitle');
                row.appendChild(appTenant);

                const appName = document.createElement('div');
                appName.innerText = appPair[1];
                appName.classList.add('appListTitle');
                row.appendChild(appName);

                const appTemplate = document.createElement('div');
                appTemplate.innerText = app.template;
                appTemplate.classList.add('appListTitle');
                row.appendChild(appTemplate);

                const modifyBtn = document.createElement('a');
                modifyBtn.classList.add('btn');
                modifyBtn.classList.add('btn-primary');
                modifyBtn.innerText = 'Modify';
                modifyBtn.href = `#modify/${appPairStr}`;
                modifyBtn.classList.add('appListEntry');
                row.appendChild(modifyBtn);

                listElem.appendChild(row);
                const deleteBtn = document.createElement('button');
                deleteBtn.classList.add('btn');
                deleteBtn.classList.add('btn-error');
                deleteBtn.innerText = 'Delete';
                deleteBtn.addEventListener('click', () => {
                    dispOutput(`Deleting ${appPairStr}`);
                    fetch(`${endPointUrl}/applications/${appPairStr}`, {
                        method: 'DELETE'
                    })
                        .then(() => {
                            window.location.href = '#tasks';
                        });
                });
                deleteBtn.classList.add('appListEntry');
                row.appendChild(deleteBtn);
            });

            dispOutput('');
        })
        .catch(e => dispOutput(`Error fetching applications: ${e.message}`));
});
route('create', 'create', () => {
    const addTmplBtns = (sets) => {
        const elem = document.getElementById('tmpl-btns');
        sets.forEach((setData) => {
            const row = document.createElement('div');
            elem.appendChild(row);
            setData.templates.map(x => x.name).forEach((item) => {
                const btn = document.createElement('button');
                btn.classList.add('btn');
                btn.classList.add('btn-primary');
                btn.classList.add('appListEntry');
                btn.innerText = item;
                btn.addEventListener('click', () => {
                    newEditor(item);
                });
                row.appendChild(btn);
            });
        });
    };
    outputElem = document.getElementById('output');
    dispOutput('Fetching templates');
    return getJSON('templatesets')
        .then((data) => {
            addTmplBtns(data);
            dispOutput('');
        })
        .catch(e => dispOutput(e.message));
});
route('modify', 'create', (appID) => {
    outputElem = document.getElementById('output');
    dispOutput(`Fetching app data for ${appID}`);
    return getJSON(`applications/${appID}`)
        .then((appData) => {
            const appDef = appData.constants.fast;
            newEditor(appDef.template, appDef.view);
        })
        .catch(e => dispOutput(e.message));
});

route('tasks', 'tasks', () => {
    const renderTaskList = () => getJSON('tasks')
        .then((data) => {
            const taskList = document.getElementById('task-list');
            taskList.innerHTML = `<div class="appListRow">
              <div class="appListTitle">Task ID</div>
              <div class="appListTitle">Tenant</div>
              <div class="appListTitle">Result</div>
            </div>`;
            taskList.appendChild(document.createElement('hr'));

            let count = 0;
            data.forEach((item) => {
                const rowDiv = document.createElement('div');
                rowDiv.classList.add('appListRow');
                count += 1;
                if (count % 2) rowDiv.classList.add('zebraRow');

                const idDiv = document.createElement('div');
                idDiv.classList.add('appListTitle');
                idDiv.innerText = item.id;
                rowDiv.appendChild(idDiv);

                const tenantDiv = document.createElement('div');
                tenantDiv.classList.add('appListTitle');
                tenantDiv.innerText = `${item.tenant}/${item.application}`;
                rowDiv.appendChild(tenantDiv);

                const statusDiv = document.createElement('div');
                statusDiv.classList.add('appListTitle');
                statusDiv.innerText = item.message;
                rowDiv.appendChild(statusDiv);

                taskList.appendChild(rowDiv);
                taskList.appendChild(document.createElement('hr'));
            });

            const inProgressJob = (
                data.filter(x => x.message === 'in progress').length !== 0
            );
            if (inProgressJob) {
                setTimeout(renderTaskList, 5000);
            }
        });

    return renderTaskList();
});

route('api', 'api', () => Promise.resolve());

route('templates', 'templates', () => {
    outputElem = document.getElementById('output');
    dispOutput('...Loading Template List...');
    const templateDiv = document.getElementById('template-list');

    document.getElementById('add-ts-btn').onclick = () => {
        document.getElementById('ts-file-input').click();
    };
    document.getElementById('ts-file-input').onchange = () => {
        const file = document.getElementById('ts-file-input').files[0];
        const tsName = file.name.slice(0, -4);
        dispOutput(`Uploading file: ${file.name}`);
        multipartUpload(file)
            .then(() => dispOutput(`Installing template set ${tsName}`))
            .then(() => fetch('/mgmt/shared/fast/templatesets', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: file.name.slice(0, -4)
                })
            }))
            .then((response) => {
                if (!response.ok) {
                    return Promise.reject(new Error(`Failed to install ${tsName}: ${JSON.stringify(response)}`));
                }
                return Promise.resolve();
            })
            .then(() => dispOutput(`${tsName} installed successfully`))
            .then(() => window.location.reload())
            .catch(e => dispOutput(`Failed to install template set: ${e.stack}`));
    };

    return Promise.all([
        getJSON('applications'),
        getJSON('templatesets')
    ])
        .then(([applications, templatesets]) => {
            const setMap = templatesets.reduce((acc, curr) => {
                acc[curr.name] = curr;
                return acc;
            }, {});

            // build dictionary of app lists, keyed by template
            const appDict = applications.reduce((a, c) => {
                if (c.template) {
                    if (!a[c.template]) {
                        a[c.template] = [];
                    }
                    a[c.template].push(c);
                }
                return a;
            }, {});

            let count = 0;
            const createRow = (rowName, rowList, actionsList) => {
                rowList = rowList || [];
                actionsList = actionsList || [];

                const row = document.createElement('div');
                row.classList.add('appListRow');
                count += 1;
                if (count % 2) {
                    row.classList.add('zebraRow');
                }

                const name = document.createElement('div');
                name.innerHTML = rowName;
                name.classList.add('appListTitle');
                row.appendChild(name);

                const applist = document.createElement('div');
                applist.classList.add('appListTitle');
                rowList.forEach((item) => {
                    const appDiv = document.createElement('div');
                    appDiv.innerText = item;
                    applist.appendChild(appDiv);
                });
                row.appendChild(applist);

                const actions = document.createElement('div');
                actions.classList.add('appListTitle');
                Object.entries(actionsList).forEach(([actName, actFn]) => {
                    const actBtn = document.createElement('a');
                    actBtn.classList.add('btn');
                    actBtn.innerText = actName;
                    actBtn.onclick = actFn;
                    actions.appendChild(actBtn);
                });
                row.appendChild(actions);

                templateDiv.appendChild(document.createElement('hr'));
                templateDiv.appendChild(row);
            };
            Object.values(setMap).forEach((setData) => {
                const setName = setData.name;
                const setActions = {
                    Remove: () => {
                        dispOutput(`Deleting ${setName}`);
                        return fetch(`${endPointUrl}/templatesets/${setName}`, {
                            method: 'DELETE'
                        })
                            .then(() => window.location.reload());
                    }
                };

                if (setData.updateAvailable) {
                    setActions.Update = () => {
                        dispOutput(`Updating ${setName}`);
                        return fetch(`${endPointUrl}/templatesets/${setName}`, {
                            method: 'DELETE'
                        })
                            .then(() => fetch(`${endPointUrl}/templatesets`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    name: setName
                                })
                            }))
                            .then(() => window.location.reload());
                    };
                }

                createRow(setName, (setData.supported) ? ['supported'] : [], setActions);
                setMap[setName].templates.forEach((tmpl) => {
                    const templateName = tmpl.name;
                    const appList = appDict[`${setName}/${templateName}`] || [];
                    createRow(`&nbsp;&nbsp;&nbsp;&nbsp;/${templateName}`, appList.map(app => `${app.tenant} ${app.name}`));
                });
            });
        })
        .then(() => dispOutput(''));
});
