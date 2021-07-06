var app = angular.module('Arbitrator', ['ui.bootstrap']);

app.controller('projectController', ['$scope', 'Project', function ($scope, Project) {
   $scope.project = Project.get();
   $scope.editingTitle = false;
   $scope.toggleEditing = function() {
      $scope.editingTitle = !$scope.editingTitle;
   };

   
   $scope.dirty = Project.isDirty;
   $scope.markDirty = Project.markDirty;
}]);

app.factory('currentPage', function () {
   var currentPage = 'Setup';
   return {
      isOnSetup: function () {
         return currentPage === 'Setup';
      },
      isOnCase: function () {
         return currentPage === 'Case';
      },
      switchToCase: function () {
         currentPage = 'Case';
      },
      switchToSetup: function () {
         currentPage = 'Setup';
      }
   }
});

app.controller('pageController', ['$scope', 'currentPage', function ($scope, currentPage) {
   $scope.isOnCase = currentPage.isOnCase;
   $scope.isOnSetup = currentPage.isOnSetup;
}]);


app.factory('Case', function () {
   var currentCase = null;
   var callbacks = [];

   return {
      getCurrent: function () {
         return currentCase;
      },
      subscribe: function (callback) {
         callbacks.push(callback);
      },
      setCurrent: function (value) {
         currentCase = value;
         callbacks.forEach(function (callback) {
            callback(currentCase);
         })
      }
   };
});

app.directive('ngEnter', function () {
   return function (scope, element, attrs) {
      element.bind("keydown keypress", function (event) {
         if (event.which === 13) {
            scope.$apply(function () {
               scope.$eval(attrs.ngEnter);
            });

            event.preventDefault();
         }
      });
   };
});

app.factory('arbitratorData', ['keyRemapper', 'questionNormalization', 'questionSorter', function(keyRemapper, questionNormalization, questionSorter) {
   var cases = {};
   const loadCompleteCallbacks = jQuery.Callbacks();

   function generateKeyMaps() {
      var fullToShortKeyMap = {};
      var shortToFullKeyMap = {};
      var i = 0;
      for (var caseKey in cases) {
         for (var questionKey in cases[caseKey]) {
            if (!(questionKey in fullToShortKeyMap)) {
               var shortenedKey = (++i).toString(36);
               fullToShortKeyMap[questionKey] = shortenedKey;
               shortToFullKeyMap[shortenedKey] = questionKey;
            }
         }
      }
      return {
         fullToShortKeyMap: fullToShortKeyMap,
         shortToFullKeyMap: shortToFullKeyMap
      };
   }

   function importRawData(fileContents, caseIdKey) {
      var parsedContents = Papa.parse(fileContents, {header: true});
      parsedContents.data.forEach(function (caseObject) {
         var caseId = caseObject[caseIdKey];
         var currentCase = cases[caseId] || {};
         for (var questionId in caseObject) {
            currentCase[questionId] = {
               value: caseObject[questionId],
               status: 1
            }
         }
         cases[caseId] = currentCase;
      });
      loadCompleteCallbacks.fire();
   }

   function isFullyArbitrated(caseId) {
      var currentCase = cases[caseId];
      if (!currentCase) {
         return false;
      }
      for (var questionKey in currentCase) {
         if (currentCase[questionKey].status === 0) {
            return false;
         }
      }
      return true;
   }

   function isPartiallyArbitrated(caseId) {
      const currentCase = cases[caseId];
      if (!currentCase) {
         return false;
      }
      for (var questionKey in currentCase) {
         if (currentCase[questionKey].status === 1) {
            return true;
         }
      }
      return false;
   }

   function getExportData(onlyIncludeFullyArbitrated) {
      var output = [];
      var questionIds = questionSorter.getSortedKeys(cases, 1);
      output.push(questionIds);
      for (var caseId in cases) {
         var currentCase = cases[caseId];
         if (onlyIncludeFullyArbitrated && !isFullyArbitrated(caseId)) {
            continue;
         }
         var row = [];
         for (var i in questionIds) {
            var questionId = questionIds[i];
            var questionObject = currentCase[questionId];
            var value = questionObject ? questionObject.value : "";
            row.push(value);
         }
         output.push(row);
      }
      return output;
   }


   function normalizeKeys() {
      var existingMappings = questionNormalization.getCurrentMap();
      _.forEach(existingMappings, function(newName, oldName) {
         renameColumn(oldName, newName);
      });
      for (var currentCase in cases) {
         identifyLongNames(cases[currentCase]);
      }
      questionNormalization.addMappings(ellipsesToNonEllipsis);
   }

   var ellipsesToNonEllipsis = {};

   function identifyLongNames(currentCase) {
      function calculateLongVersion(abbreviatedQuestionId) {
         if (!questionId.endsWith('...')) {
            return;
         }

         if (abbreviatedQuestionId in ellipsesToNonEllipsis) {
            return;
         }

         var removedEllipses = abbreviatedQuestionId.substring(0, abbreviatedQuestionId.length - 3);
         var wasSet = false;
         for (var otherId in currentCase) {
            if (otherId.startsWith(removedEllipses) && otherId !== abbreviatedQuestionId) {
               ellipsesToNonEllipsis[abbreviatedQuestionId] = otherId;
               wasSet = true;
               break;
            }
         }
      }

      for (var questionId in currentCase) {
         calculateLongVersion(questionId);
      }
   }

   questionNormalization.addRemappingCallback(renameColumn);
   function renameColumn(oldKey, newKey) {
      for (var caseId in cases) {
         var caseObject = cases[caseId];
         remapCaseColumnNames(oldKey, newKey, caseObject, caseId);
      }
   }

   function remapCaseColumnNames(oldName, updatedName, caseObject, caseId) {
      var oldValue = caseObject[oldName];
      if (!oldValue) {
         return;
      }
      var alreadyRemappedValue = caseObject[updatedName];

      delete caseObject[oldName];

      var preferOldValue = !alreadyRemappedValue || alreadyRemappedValue.value === "";
      if (preferOldValue) {
         caseObject[updatedName] = oldValue;
         return;
      }

      var keepUpdatedValue = angular.equals(alreadyRemappedValue, oldValue) || oldValue.value === "";
      if (keepUpdatedValue) {
         return;
      }

      console.log("Unable to fix case ", caseId, " for: ", oldName);
      caseObject[updatedName].status =  0;
   }



   return {
      getCase: function (caseKey) {
         if (!(caseKey in cases)) {
            cases[caseKey] = {};
         }
         return cases[caseKey];
      },
      getDataForSaving: function() {
         var keyMaps = generateKeyMaps();
         var fullToShortKeyMap = keyMaps.fullToShortKeyMap;
         var shortToFullKeyMap = keyMaps.shortToFullKeyMap;
         var shortMappedData = {};
         for (var caseId in cases) {
            shortMappedData[caseId] = keyRemapper.remapKeys(fullToShortKeyMap, cases[caseId]);
         }
         return {
            data: shortMappedData,
            keyMap: shortToFullKeyMap
         };
      },
      importRawData: importRawData,
      setDataFromLoading: function(arbitrationValues) {
         var unmappedCases = arbitrationValues.data;
         var shortToFullKeyMap = arbitrationValues.keyMap;
         for (var caseId in unmappedCases) {
            cases[caseId] = keyRemapper.remapKeys(shortToFullKeyMap, unmappedCases[caseId]);
         }
         normalizeKeys();
         loadCompleteCallbacks.fire();
      },
      getExportData: getExportData,
      isFullyArbitrated: isFullyArbitrated,
      isPartiallyArbitrated: isPartiallyArbitrated,
      addLoadCompleteCallback: function(callback) {
         loadCompleteCallbacks.add(callback);
      },
   }

}]);
app.controller('caseController', ['$scope', 'Case', 'coderData', 'arbitratorData', 'Project', 'caseInfoService', 'sidebarRefreshService',
   function($scope, Case, coderData, arbitratorData, Project, caseInfoService, sidebarRefreshService) {

   Case.subscribe(onSetCase);

   let Status = {
      NotArbitrated: 0,
      Arbitrated: 1
   };

   $scope.hideArbitrated = {
      value: false
   };

   $scope.hideBlanks = {
      value: false
   };

   onSetCase(Case.getCurrent());

   function onSetCase(caseId) {
      let caseData = coderData.getCase(caseId);

      const project = Project.get();

      const allCaseInfos = project.caseInfo;
      $scope.caseInfo = allCaseInfos[caseId] || {
         notes: "",
         flag: 0,
      };
      allCaseInfos[caseId] = $scope.caseInfo;

      $scope.caseId = caseId;
      const coderKeys = Object.keys(caseData);

      $scope.coder1Name = coderKeys[0];
      $scope.coder1 = caseData[$scope.coder1Name];

      if (coderKeys.length > 1) {
         $scope.coder2Name = coderKeys[1];
         $scope.coder2 = caseData[$scope.coder2Name];
      } else {
         $scope.coder2Name = "None";
         $scope.coder2 = {};
      }

      $scope.expandedRows = {};
      $scope.questionIds = Object.keys($scope.coder1);

      $scope.caseTitle = caseInfoService.getFullTitle(caseId);


      loadArbitratedData(caseId);
      guessArbitratedData();
   }

   function loadArbitratedData(caseId) {
      let storedArbitration  = arbitratorData.getCase(caseId);
      angular.forEach($scope.questionIds, function(questionId) {
         if (angular.isUndefined(storedArbitration[questionId])) {
            storedArbitration[questionId] =  {value: "", status:Status.NotArbitrated};
         }
      });
      $scope.arbitrator = storedArbitration;
   }

   function guessArbitratedData() {
      // TODO: Fill in arbitrator.
   }

   function getQuestionsToResolve() {
      return $scope.questionIds.filter(function(questionId) {
         let alreadyArbitrated = $scope.arbitrator[questionId] && $scope.arbitrator[questionId].status;
         return !alreadyArbitrated && $scope.coder1[questionId] === $scope.coder2[questionId];
      })
   }

   $scope.autoResolve = function() {
      let questions = getQuestionsToResolve();
      questions.forEach(function(questionId) {
         $scope.arbitrator[questionId].value = $scope.coder1[questionId];
         $scope.arbitrator[questionId].status = Status.Arbitrated;
      });
      Project.markDirty();
      sidebarRefreshService.triggerRefresh($scope.caseId);
   };

   $scope.canAutoResolve = function() {
      return getQuestionsToResolve().length > 0;
   };

   $scope.progress = function() {
      let arbitratedCount = 0;
      angular.forEach($scope.questionIds, function(questionId) {
         if ($scope.isArbitrated(questionId)) {
            arbitratedCount++;
         }
      });
      return Math.floor(100 * arbitratedCount / $scope.questionIds.length);
   };

   $scope.isEquivalent = function(questionId) {
      let value1 = $scope.coder1[questionId];
      let value2 = $scope.coder2[questionId];
      return value1 === value2;
   };

   $scope.isArbitrated = function(questionId) {
      return $scope.arbitrator[questionId].status === Status.Arbitrated;
   };

   $scope.isBlank = function(questionId) {
      return $scope.coder1[questionId] === "" && $scope.coder2[questionId] === "";
   }

   function setArbitrated(questionId, value) {
      $scope.arbitrator[questionId].status = value;
      Project.markDirty();
      sidebarRefreshService.triggerRefresh($scope.caseId);
   }

   $scope.disableArbitration = function(questionId) {
      setArbitrated(questionId, Status.NotArbitrated)
   };

   $scope.enableArbitration = function(questionId) {
      setArbitrated(questionId, Status.Arbitrated);
   };

   $scope.onArbitrationChange = function(questionId) {
      $scope.disableArbitration(questionId);
      Project.markDirty();
      sidebarRefreshService.triggerRefresh($scope.caseId);
   };

   $scope.toggleArbitration = function(questionId) {
      if ($scope.isArbitrated(questionId)) {
         $scope.disableArbitration(questionId);
      } else {
         $scope.enableArbitration(questionId);
      }
   };

   $scope.acceptCoder = function(questionId, coder) {
      $scope.arbitrator[questionId].value = coder[questionId];
      setArbitrated(questionId, Status.Arbitrated);
   }

   $scope.cycleFlag = function() {
      const numFlags = 4;
      $scope.caseInfo.flag = ($scope.caseInfo.flag + 1) % numFlags;
      Project.markDirty();
      sidebarRefreshService.triggerRefresh($scope.caseId);
   }
}]);


app.factory('caseInfoService', ['Project', 'coderData', function(Project, coderData) {

   function getFullTitle(caseId) {
      const caseData = coderData.getCase(caseId);
      const coderKeys = Object.keys(caseData);
      const firstCoderData = caseData[coderKeys[0]]
      const titleFromHeaders = Project.get().invariateHeaders.map((questionId) => {
         return firstCoderData[questionId]
      }).join(' ');
      return `Case ${caseId} | ${titleFromHeaders}`
   }

   function getFlag(caseId) {
      const caseInfo = Project.get().caseInfo[caseId];
      return caseInfo ? caseInfo.flag : 0;
   }

   return {
      getFullTitle: getFullTitle,
      getFlag: getFlag,
   }
}]);
app.factory('coderData', ['questionNormalization', 'keyRemapper', 'questionSorter',
 function(questionNormalization, keyRemapper, questionSorter) {
   var cases = {};
   var loadCompleteCallbacks = jQuery.Callbacks();

   function importCaseData(coderId, parsedData) {
      for (var caseId in parsedData) {
         if (!cases[caseId]) {
            cases[caseId] = {};
         }
         cases[caseId][coderId] = parsedData[caseId];
      }
   }

   function trimWhitespaceInValues(caseObject) {
      for (var key in caseObject) {
         caseObject[key] = caseObject[key].trim();
      }
   }

   function importRawData(fileContents, caseIdKey, coderIdKey) {
      var parsedContents = Papa.parse(fileContents, {header: true});
      var parsedData = {};
      var coderId = parsedContents.data[0][coderIdKey];

      var existingMappings = questionNormalization.getCurrentMap();
      parsedContents.data.forEach(function (caseObject) {
         var caseId = caseObject[caseIdKey];
         trimWhitespaceInValues(caseObject);
         var normalizedCaseObject = keyRemapper.remapKeys(existingMappings, caseObject);
         parsedData[caseId] = normalizedCaseObject;
      });
      importCaseData(coderId, parsedData);
      loadCompleteCallbacks.fire();
   }

   questionNormalization.addRemappingCallback(renameColumn);
   function renameColumn(oldName, newName) {
      _.forEach(cases, function(caseObject) {
         _.forEach(caseObject, function(coderObject) {
            coderObject[newName] = coderObject[oldName];
            delete coderObject[oldName];
         });
      })
   }

   function getReliability() {
      var questionIds = questionSorter.getSortedKeys(cases, 2)
      var headerRow = ['Case Id'].concat(questionIds);
      headerRow.push('Case Average');
      var output = [headerRow];

      var questionMatchCounts = {};
      _.forEach(questionIds, function(questionId) {
         questionMatchCounts[questionId] = 0;
      });

      var doubleCountedCount = 0;
      _.forEach(cases, function(caseObject, caseId) {
         var coderKeys = Object.keys(caseObject);
         var coder1 = caseObject[coderKeys[0]];

         var row = [caseId];
         if (coderKeys.length === 2) {
            doubleCountedCount += 1;
            var coder2 = caseObject[coderKeys[1]];
            var caseMatchCount = 0;
            _.forEach(questionIds, function(questionId) {
               var matchValue = coder1[questionId] === coder2[questionId] ? 1 : 0;
               caseMatchCount += matchValue;
               questionMatchCounts[questionId] += matchValue;
               row.push(matchValue);
            });
            row.push(caseMatchCount / questionIds.length);
         }

         output.push(row);
      })

      var totalRow = ['Question Average'];
      _.forEach(questionIds, function(questionId) {
         var questionMatchCount = questionMatchCounts[questionId]
         totalRow.push(questionMatchCount / doubleCountedCount);
      })
      output.push(totalRow);

      return output;
   }

   return {
      getCase: function (caseId) {
         return cases[caseId];
      },
      getCases: function() {
         return cases;
      },
      importRawData: importRawData,
      addLoadCompleteCallback: function(callback) {
         loadCompleteCallbacks.add(callback);
      },
      getReliability: getReliability,
   }
}]);

app.factory('disk', ['Project', 'arbitratorData', 'questionNormalization', 'coderData',
function(Project, arbitratorData, questionNormalization, coderData) {

   var savableServices = {
      arbitrator: arbitratorData,
      projectMeta: Project,
      questionNormalization: questionNormalization
   };

   function getFilename() {
      var name = Project.get().name || 'Arbitration';
      var d = new Date();
      var dateString =  d.getFullYear() + "-" + (d.getMonth()+1) + "-" + d.getDate() + " " +
         d.getHours() + "_" + d.getMinutes();
      return name + "_" + dateString
   }

   function writeToDisk(stringData, filename) { // aka "Download"
      var a = window.document.createElement('a');
      a.href = window.URL.createObjectURL(new Blob([stringData], {type: 'text'}));
      a.download = filename;

      // Append anchor to body.
      document.body.appendChild(a)
      a.click();

      // Remove anchor from body
      document.body.removeChild(a)
   }

   function save() {
      Project.clearDirtyFlag();

      var projectData = _.reduce(savableServices, function(result, service, serviceKey) {
         result[serviceKey] = service.getDataForSaving();
         return result;
      }, {});

      var filename = getFilename() + ".arb";

      var pretty = false;
      var stringData = pretty ?
         JSON.stringify(projectData, null, 3) :
         JSON.stringify(projectData);

      writeToDisk(stringData, filename);
   }

   function loadProject(fileContents) {
      Project.clearDirtyFlag();
      var saveData = JSON.parse(fileContents);
      _.each(saveData, function(storedValue, serviceKey) {
         var service = savableServices[serviceKey];
         if (service) {
            service.setDataFromLoading(storedValue);
         } else {
            console.warn("Skipped value for " + serviceKey);
         }
      });
   }

   function exportCsv(onlyExportFullyArbitrated) {
      var exportData = arbitratorData.getExportData(onlyExportFullyArbitrated);
      var stringData = Papa.unparse(exportData, {delimiter: ','})
      var filename = getFilename() + ".csv";
      writeToDisk(stringData, filename);
   }

   function exportReliability() {
      var reliabilityData = coderData.getReliability();
      var stringData = Papa.unparse(reliabilityData, {delimiter: ','})
      var filename = "Reliability_" + getFilename() + ".csv"
      writeToDisk(stringData, filename);
   }

   return {
      load: loadProject,
      save: save,
      exportCsv: exportCsv,
      exportReliability: exportReliability,
   }
}]);

function executeContents($scope, callback, file) {
   var r = new FileReader();
   r.onload = function (e) {
      var contents = e.target.result;
      $scope.$apply(function () {
         callback(contents);
      });
   };
   r.readAsText(file);
   return r;
}

app.directive('fileReader', function () {
   function readFiles(files, $scope) {
      for (var i = 0; i < files.length; i++) {
         var file = files[i];
         var callback = $scope.handleLoad;
         executeContents($scope, callback, file);
      }
   }

   function readArbitratorFile(files, $scope) {
      var callback = $scope.handleArbitratorLoad;
      executeContents($scope, callback, files[0]);
   }

   return {
      scope: true,
      link: function ($scope, element) {
         element.on('change', function (changeEvent) {
            var files = changeEvent.target.files;
            if (element[0].id === 'arbitratorFile') {
               readArbitratorFile(files, $scope)     ;
            } else {
               readFiles(files, $scope);
            }
            element[0].value = null;
         });
      }
   };
});
app.factory('keyRemapper', function() {

   function remapKeys(keyMap, object) {
      return _.reduce(object, function (result, value, currentKey) {
         var updatedKey = keyMap[currentKey] || currentKey;
         result[updatedKey] = value;
         return result;
      }, {});
   }

   return {
      remapKeys: remapKeys
   }
});
app.factory('Project', function() {
   var project = {
      name: 'Arbitration',
      caseIdKey: 'Q38 Case ID (from spreadsheet)', // TODO: Don't hard-code these.
      coderIdKey: 'Q39 Coder:',
      caseInfo: {},
      invariateHeaders: ['Q57 Country Name (from spreadsheet)', 'Q56 Year (from spreadsheet)']
   };

   var dirty = false;

   return {
      get: function() {
         return project;
      },
      isDirty: function() {
         return dirty;
      },
      markDirty: function() {
         dirty = true;
      },
      clearDirtyFlag: function() {
         dirty = false;
      },
      getDataForSaving: function() {
         return project;
      },
      setDataFromLoading: function(loadedData) {
         angular.merge(project, loadedData);
      },
   }
});
app.factory('questionNormalization', ['questionSorter', function(questionSorter) {
   var keyMap = {};

   var remappingCallbacks = jQuery.Callbacks();

   function addMappings(mappings) {
      angular.merge(keyMap, mappings);
      _.forEach(mappings, function(newName, oldName) {
         remappingCallbacks.fire(oldName, newName);
      });
   }

   function removeMapping(oldName) {
      var newName = keyMap[oldName];
      remappingCallbacks.fire(newName, oldName);
      delete keyMap[oldName];
   }

   function getCurrentMap() {
      return keyMap;
   }

   function getSortedMap() {
      var sortedKeys = questionSorter.getSortedKeys(keyMap, 0);
      return sortedKeys.map(function(key) {
         return {
            oldName: key,
            newName: keyMap[key]
         }
      });
   }

   return {
      addMappings: addMappings,
      removeMapping: removeMapping,
      setDataFromLoading: addMappings,
      getCurrentMap: getCurrentMap,
      getSortedMap: getSortedMap,
      getDataForSaving: getCurrentMap,

      addRemappingCallback: function (callback) {
         remappingCallbacks.add(callback);
      }
   }
}]);
app.factory('questionSorter', function() {

   function qualtricsSort(a, b) {
      function qualtricsNum(questionId) {  // Not proud of this function
         try {
            questionId = questionId.split(" ")[0];
            var undIndex = questionId.indexOf("_");
            if (undIndex == -1) {
               undIndex = questionId.length;
            }
            var questionNum = parseInt(questionId.substring(1, undIndex+1));
            questionId = questionId.substring(undIndex+1);
            var nextUndIndex = questionId.indexOf("_");
            if (nextUndIndex == -1) {
               return questionNum;
            }
            var subNum = parseInt(questionId.substring(0, undIndex+1));
            return questionNum + subNum/100;
         } catch (e) {
            return -1;
         }
      }
      return qualtricsNum(a) - qualtricsNum(b);
   }

   function getSortedKeys(objectWithKeys, depth) {
      var uniqueKeys = {};
      for (var baseKey in objectWithKeys) {
         if (depth > 0) {
            var nestedObject = objectWithKeys[baseKey];
            for (var nestedKey in nestedObject) {
               if (depth > 1) {
                  var nestedNestedObject = nestedObject[nestedKey];
                  for (var doubleNestedKey in nestedNestedObject) {
                     uniqueKeys[doubleNestedKey] = undefined;
                  }
               } else {
                  uniqueKeys[nestedKey] = undefined;
               }
            }
         } else {
            uniqueKeys[baseKey] = undefined;
         }
      }
      return Object.keys(uniqueKeys).sort(qualtricsSort)
   }

   return {
      getSortedKeys: getSortedKeys,
   }
})
app.controller('setupController', ['$scope', 'coderData', 'arbitratorData', 'sidebarDisplayCases', 'Project', 'questionNormalization',
      function($scope, coderData, arbitratorData, sidebarDisplayCases, Project, questionNormalization) {

   $scope.project = Project.get();

   $scope.handleLoad = function(fileContents) {
      coderData.importRawData(fileContents, $scope.project.caseIdKey, $scope.project.coderIdKey);
   };

   $scope.handleArbitratorLoad = function(fileContents) {
      arbitratorData.importRawData(fileContents, $scope.project.caseIdKey);
   };


   function clearAdding() {
      $scope.adding = false;
      $scope.addedOld = "";
      $scope.addedNew = "";
      editedRowKey = null;
   }
   clearAdding();

   $scope.startAdding = function() {
      $scope.adding = true;
   };

   $scope.finishAdding = function() {
      $scope.adding = false;
      var oldName = $scope.addedOld;
      if (questionNormalization.getCurrentMap()[oldName]) {
         questionNormalization.removeMapping(oldName);
      }
      var mapping = {};
      mapping[oldName] = $scope.addedNew;
      questionNormalization.addMappings(mapping);
      clearAdding();
      refresh();
   };

   $scope.cancelAdding = function() {
      $scope.adding = false;
      clearAdding();
   };

   $scope.edit = function(oldText, newText) {
      $scope.addedOld = oldText;
      $scope.addedNew = newText;
      $scope.adding = true;
      editedRowKey = oldText;
   };

   $scope.removeMapping = function(oldText) {
      questionNormalization.removeMapping(oldText);
      refresh();
   };

   var editedRowKey = null;
   $scope.isEditing = function(oldText) {
      return oldText === editedRowKey;
   };

   function refresh() {
      $scope.normalizedKeyMap = questionNormalization.getSortedMap();
   }
   arbitratorData.addLoadCompleteCallback(refresh);
}]);
app.controller('sidebarController', ['$scope', 'sidebarDisplayCases', 'currentPage', 'Case', function($scope, sidebarDisplayCases, currentPage, Case) {
   $scope.getCases = sidebarDisplayCases.get;
   var includeSingleCoded = {
      display: 'Single Coded',
      value: false
   };
   var includeDoubleCoded = {
      display: 'Double Coded',
      value: true
   };
   var includeFullyArbitrated = {
      display: 'Fully Arbitrated',
      value: false
   };

   $scope.filters = [
      includeSingleCoded,
      includeDoubleCoded,
      includeFullyArbitrated
   ];
   $scope.filterText = "";

   function passesArbitrationCheckboxes(caseObject) {
      if (caseObject.count == 1) {
         return includeSingleCoded.value;
      }
      return caseObject.fullyArbitrated ?
         includeFullyArbitrated.value :
         includeDoubleCoded.value;
   }

   function passesFilterText(caseObject) {
      return $scope.filterText == "" ||
             caseObject.displayText.indexOf($scope.filterText) > -1;
   }

   function passesCoderCheckboxes(caseObject) {

   }

   $scope.shouldDisplay = function(caseObject) {
      return passesArbitrationCheckboxes(caseObject) && passesFilterText(caseObject);
   };

   $scope.switchToCase = function(caseKey) {
      currentPage.switchToCase();
      Case.setCurrent(caseKey);
   };

   $scope.isSelected = function(caseId) {
      return Case.getCurrent() === caseId;
   }
}]);


app.factory('sidebarRefreshService', function() {
   const callbacks = jQuery.Callbacks();
   return {
      subscribeToRefresh: function(callback) {
         callbacks.add(callback);
      },
      triggerRefresh: function(caseId) {
         callbacks.fire(caseId);
      }
   }
});
app.factory('sidebarDisplayCases', ['coderData', 'arbitratorData', 'caseInfoService', 'sidebarRefreshService',
function(coderData, arbitratorData, caseInfoService, sidebarRefreshService) {
   var displayCases = [];

   function refresh() {
      var cases = coderData.getCases();
      displayCases = Object.keys(cases).map(function (caseId) {
         return {
            id: caseId,
            count: Object.keys(cases[caseId]).length,
            fullyArbitrated: arbitratorData.isFullyArbitrated(caseId),
            partiallyArbitrated: arbitratorData.isPartiallyArbitrated(caseId),
            displayText: caseInfoService.getFullTitle(caseId),
            flag: caseInfoService.getFlag(caseId),
         }
      });
   }

   function refreshCase(caseId) {
      console.log(caseId);
      refresh(); //TODO This is more than necessary.
   }

   arbitratorData.addLoadCompleteCallback(refresh);
   coderData.addLoadCompleteCallback(refresh);
   sidebarRefreshService.subscribeToRefresh(refreshCase);

   return {
      get: function() {
         return displayCases;
      }
   }

}]);
app.controller('toolbarController', ['$scope', 'Project', 'currentPage', 'disk',
   function($scope, Project, currentPage, disk) {
      $scope.save = disk.save;
      $scope.open = disk.load;
      $scope.exportReliability = disk.exportReliability;
      $scope.switchToSetup = currentPage.switchToSetup;
      $scope.onlyIncludeFullyArbitrated = {
         value: false
      };
      $scope.export = function() {
         disk.exportCsv($scope.onlyIncludeFullyArbitrated.value);
      };

      $scope.handleLoad = disk.load;
}]);

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImFwcC5qcyIsImFyYml0cmF0b3JEYXRhLmpzIiwiY2FzZS1jb250cm9sbGVyLmpzIiwiY2FzZS1pbmZvLXNlcnZpY2UuanMiLCJjb2RlckRhdGEuanMiLCJkaXNrLmpzIiwiZmlsZVJlYWRlci5qcyIsImtleVJlbWFwcGVyLmpzIiwicHJvamVjdC5qcyIsInF1ZXN0aW9uTm9ybWFsaXphdGlvbi5qcyIsInF1ZXN0aW9uU29ydGVyLmpzIiwic2V0dXAtY29udHJvbGxlci5qcyIsInNpZGViYXItY29udHJvbGxlci5qcyIsInNpZGViYXItcmVmcmVzaC1zZXJ2aWNlLmpzIiwic2lkZWJhckRpc3BsYXlDYXNlcy5qcyIsInRvb2xiYXItY29udHJvbGxlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUN2RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUN0TUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUM1SkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQ3ZHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDbEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUN4Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUMvQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQ2xEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUNqRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUN0REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImFyYml0cmF0aW9uLmpzIiwic291cmNlc0NvbnRlbnQiOlsidmFyIGFwcCA9IGFuZ3VsYXIubW9kdWxlKCdBcmJpdHJhdG9yJywgWyd1aS5ib290c3RyYXAnXSk7XHJcblxyXG5hcHAuY29udHJvbGxlcigncHJvamVjdENvbnRyb2xsZXInLCBbJyRzY29wZScsICdQcm9qZWN0JywgZnVuY3Rpb24gKCRzY29wZSwgUHJvamVjdCkge1xyXG4gICAkc2NvcGUucHJvamVjdCA9IFByb2plY3QuZ2V0KCk7XHJcbiAgICRzY29wZS5lZGl0aW5nVGl0bGUgPSBmYWxzZTtcclxuICAgJHNjb3BlLnRvZ2dsZUVkaXRpbmcgPSBmdW5jdGlvbigpIHtcclxuICAgICAgJHNjb3BlLmVkaXRpbmdUaXRsZSA9ICEkc2NvcGUuZWRpdGluZ1RpdGxlO1xyXG4gICB9O1xyXG5cclxuICAgXHJcbiAgICRzY29wZS5kaXJ0eSA9IFByb2plY3QuaXNEaXJ0eTtcclxuICAgJHNjb3BlLm1hcmtEaXJ0eSA9IFByb2plY3QubWFya0RpcnR5O1xyXG59XSk7XHJcblxyXG5hcHAuZmFjdG9yeSgnY3VycmVudFBhZ2UnLCBmdW5jdGlvbiAoKSB7XHJcbiAgIHZhciBjdXJyZW50UGFnZSA9ICdTZXR1cCc7XHJcbiAgIHJldHVybiB7XHJcbiAgICAgIGlzT25TZXR1cDogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICByZXR1cm4gY3VycmVudFBhZ2UgPT09ICdTZXR1cCc7XHJcbiAgICAgIH0sXHJcbiAgICAgIGlzT25DYXNlOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgIHJldHVybiBjdXJyZW50UGFnZSA9PT0gJ0Nhc2UnO1xyXG4gICAgICB9LFxyXG4gICAgICBzd2l0Y2hUb0Nhc2U6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgY3VycmVudFBhZ2UgPSAnQ2FzZSc7XHJcbiAgICAgIH0sXHJcbiAgICAgIHN3aXRjaFRvU2V0dXA6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgY3VycmVudFBhZ2UgPSAnU2V0dXAnO1xyXG4gICAgICB9XHJcbiAgIH1cclxufSk7XHJcblxyXG5hcHAuY29udHJvbGxlcigncGFnZUNvbnRyb2xsZXInLCBbJyRzY29wZScsICdjdXJyZW50UGFnZScsIGZ1bmN0aW9uICgkc2NvcGUsIGN1cnJlbnRQYWdlKSB7XHJcbiAgICRzY29wZS5pc09uQ2FzZSA9IGN1cnJlbnRQYWdlLmlzT25DYXNlO1xyXG4gICAkc2NvcGUuaXNPblNldHVwID0gY3VycmVudFBhZ2UuaXNPblNldHVwO1xyXG59XSk7XHJcblxyXG5cclxuYXBwLmZhY3RvcnkoJ0Nhc2UnLCBmdW5jdGlvbiAoKSB7XHJcbiAgIHZhciBjdXJyZW50Q2FzZSA9IG51bGw7XHJcbiAgIHZhciBjYWxsYmFja3MgPSBbXTtcclxuXHJcbiAgIHJldHVybiB7XHJcbiAgICAgIGdldEN1cnJlbnQ6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgcmV0dXJuIGN1cnJlbnRDYXNlO1xyXG4gICAgICB9LFxyXG4gICAgICBzdWJzY3JpYmU6IGZ1bmN0aW9uIChjYWxsYmFjaykge1xyXG4gICAgICAgICBjYWxsYmFja3MucHVzaChjYWxsYmFjayk7XHJcbiAgICAgIH0sXHJcbiAgICAgIHNldEN1cnJlbnQ6IGZ1bmN0aW9uICh2YWx1ZSkge1xyXG4gICAgICAgICBjdXJyZW50Q2FzZSA9IHZhbHVlO1xyXG4gICAgICAgICBjYWxsYmFja3MuZm9yRWFjaChmdW5jdGlvbiAoY2FsbGJhY2spIHtcclxuICAgICAgICAgICAgY2FsbGJhY2soY3VycmVudENhc2UpO1xyXG4gICAgICAgICB9KVxyXG4gICAgICB9XHJcbiAgIH07XHJcbn0pO1xyXG5cclxuYXBwLmRpcmVjdGl2ZSgnbmdFbnRlcicsIGZ1bmN0aW9uICgpIHtcclxuICAgcmV0dXJuIGZ1bmN0aW9uIChzY29wZSwgZWxlbWVudCwgYXR0cnMpIHtcclxuICAgICAgZWxlbWVudC5iaW5kKFwia2V5ZG93biBrZXlwcmVzc1wiLCBmdW5jdGlvbiAoZXZlbnQpIHtcclxuICAgICAgICAgaWYgKGV2ZW50LndoaWNoID09PSAxMykge1xyXG4gICAgICAgICAgICBzY29wZS4kYXBwbHkoZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICBzY29wZS4kZXZhbChhdHRycy5uZ0VudGVyKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICB9O1xyXG59KTtcclxuIiwiYXBwLmZhY3RvcnkoJ2FyYml0cmF0b3JEYXRhJywgWydrZXlSZW1hcHBlcicsICdxdWVzdGlvbk5vcm1hbGl6YXRpb24nLCAncXVlc3Rpb25Tb3J0ZXInLCBmdW5jdGlvbihrZXlSZW1hcHBlciwgcXVlc3Rpb25Ob3JtYWxpemF0aW9uLCBxdWVzdGlvblNvcnRlcikge1xyXG4gICB2YXIgY2FzZXMgPSB7fTtcclxuICAgY29uc3QgbG9hZENvbXBsZXRlQ2FsbGJhY2tzID0galF1ZXJ5LkNhbGxiYWNrcygpO1xyXG5cclxuICAgZnVuY3Rpb24gZ2VuZXJhdGVLZXlNYXBzKCkge1xyXG4gICAgICB2YXIgZnVsbFRvU2hvcnRLZXlNYXAgPSB7fTtcclxuICAgICAgdmFyIHNob3J0VG9GdWxsS2V5TWFwID0ge307XHJcbiAgICAgIHZhciBpID0gMDtcclxuICAgICAgZm9yICh2YXIgY2FzZUtleSBpbiBjYXNlcykge1xyXG4gICAgICAgICBmb3IgKHZhciBxdWVzdGlvbktleSBpbiBjYXNlc1tjYXNlS2V5XSkge1xyXG4gICAgICAgICAgICBpZiAoIShxdWVzdGlvbktleSBpbiBmdWxsVG9TaG9ydEtleU1hcCkpIHtcclxuICAgICAgICAgICAgICAgdmFyIHNob3J0ZW5lZEtleSA9ICgrK2kpLnRvU3RyaW5nKDM2KTtcclxuICAgICAgICAgICAgICAgZnVsbFRvU2hvcnRLZXlNYXBbcXVlc3Rpb25LZXldID0gc2hvcnRlbmVkS2V5O1xyXG4gICAgICAgICAgICAgICBzaG9ydFRvRnVsbEtleU1hcFtzaG9ydGVuZWRLZXldID0gcXVlc3Rpb25LZXk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgIGZ1bGxUb1Nob3J0S2V5TWFwOiBmdWxsVG9TaG9ydEtleU1hcCxcclxuICAgICAgICAgc2hvcnRUb0Z1bGxLZXlNYXA6IHNob3J0VG9GdWxsS2V5TWFwXHJcbiAgICAgIH07XHJcbiAgIH1cclxuXHJcbiAgIGZ1bmN0aW9uIGltcG9ydFJhd0RhdGEoZmlsZUNvbnRlbnRzLCBjYXNlSWRLZXkpIHtcclxuICAgICAgdmFyIHBhcnNlZENvbnRlbnRzID0gUGFwYS5wYXJzZShmaWxlQ29udGVudHMsIHtoZWFkZXI6IHRydWV9KTtcclxuICAgICAgcGFyc2VkQ29udGVudHMuZGF0YS5mb3JFYWNoKGZ1bmN0aW9uIChjYXNlT2JqZWN0KSB7XHJcbiAgICAgICAgIHZhciBjYXNlSWQgPSBjYXNlT2JqZWN0W2Nhc2VJZEtleV07XHJcbiAgICAgICAgIHZhciBjdXJyZW50Q2FzZSA9IGNhc2VzW2Nhc2VJZF0gfHwge307XHJcbiAgICAgICAgIGZvciAodmFyIHF1ZXN0aW9uSWQgaW4gY2FzZU9iamVjdCkge1xyXG4gICAgICAgICAgICBjdXJyZW50Q2FzZVtxdWVzdGlvbklkXSA9IHtcclxuICAgICAgICAgICAgICAgdmFsdWU6IGNhc2VPYmplY3RbcXVlc3Rpb25JZF0sXHJcbiAgICAgICAgICAgICAgIHN0YXR1czogMVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgIH1cclxuICAgICAgICAgY2FzZXNbY2FzZUlkXSA9IGN1cnJlbnRDYXNlO1xyXG4gICAgICB9KTtcclxuICAgICAgbG9hZENvbXBsZXRlQ2FsbGJhY2tzLmZpcmUoKTtcclxuICAgfVxyXG5cclxuICAgZnVuY3Rpb24gaXNGdWxseUFyYml0cmF0ZWQoY2FzZUlkKSB7XHJcbiAgICAgIHZhciBjdXJyZW50Q2FzZSA9IGNhc2VzW2Nhc2VJZF07XHJcbiAgICAgIGlmICghY3VycmVudENhc2UpIHtcclxuICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICB9XHJcbiAgICAgIGZvciAodmFyIHF1ZXN0aW9uS2V5IGluIGN1cnJlbnRDYXNlKSB7XHJcbiAgICAgICAgIGlmIChjdXJyZW50Q2FzZVtxdWVzdGlvbktleV0uc3RhdHVzID09PSAwKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICB9XHJcblxyXG4gICBmdW5jdGlvbiBpc1BhcnRpYWxseUFyYml0cmF0ZWQoY2FzZUlkKSB7XHJcbiAgICAgIGNvbnN0IGN1cnJlbnRDYXNlID0gY2FzZXNbY2FzZUlkXTtcclxuICAgICAgaWYgKCFjdXJyZW50Q2FzZSkge1xyXG4gICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgIH1cclxuICAgICAgZm9yICh2YXIgcXVlc3Rpb25LZXkgaW4gY3VycmVudENhc2UpIHtcclxuICAgICAgICAgaWYgKGN1cnJlbnRDYXNlW3F1ZXN0aW9uS2V5XS5zdGF0dXMgPT09IDEpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgIH1cclxuXHJcbiAgIGZ1bmN0aW9uIGdldEV4cG9ydERhdGEob25seUluY2x1ZGVGdWxseUFyYml0cmF0ZWQpIHtcclxuICAgICAgdmFyIG91dHB1dCA9IFtdO1xyXG4gICAgICB2YXIgcXVlc3Rpb25JZHMgPSBxdWVzdGlvblNvcnRlci5nZXRTb3J0ZWRLZXlzKGNhc2VzLCAxKTtcclxuICAgICAgb3V0cHV0LnB1c2gocXVlc3Rpb25JZHMpO1xyXG4gICAgICBmb3IgKHZhciBjYXNlSWQgaW4gY2FzZXMpIHtcclxuICAgICAgICAgdmFyIGN1cnJlbnRDYXNlID0gY2FzZXNbY2FzZUlkXTtcclxuICAgICAgICAgaWYgKG9ubHlJbmNsdWRlRnVsbHlBcmJpdHJhdGVkICYmICFpc0Z1bGx5QXJiaXRyYXRlZChjYXNlSWQpKSB7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICB9XHJcbiAgICAgICAgIHZhciByb3cgPSBbXTtcclxuICAgICAgICAgZm9yICh2YXIgaSBpbiBxdWVzdGlvbklkcykge1xyXG4gICAgICAgICAgICB2YXIgcXVlc3Rpb25JZCA9IHF1ZXN0aW9uSWRzW2ldO1xyXG4gICAgICAgICAgICB2YXIgcXVlc3Rpb25PYmplY3QgPSBjdXJyZW50Q2FzZVtxdWVzdGlvbklkXTtcclxuICAgICAgICAgICAgdmFyIHZhbHVlID0gcXVlc3Rpb25PYmplY3QgPyBxdWVzdGlvbk9iamVjdC52YWx1ZSA6IFwiXCI7XHJcbiAgICAgICAgICAgIHJvdy5wdXNoKHZhbHVlKTtcclxuICAgICAgICAgfVxyXG4gICAgICAgICBvdXRwdXQucHVzaChyb3cpO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBvdXRwdXQ7XHJcbiAgIH1cclxuXHJcblxyXG4gICBmdW5jdGlvbiBub3JtYWxpemVLZXlzKCkge1xyXG4gICAgICB2YXIgZXhpc3RpbmdNYXBwaW5ncyA9IHF1ZXN0aW9uTm9ybWFsaXphdGlvbi5nZXRDdXJyZW50TWFwKCk7XHJcbiAgICAgIF8uZm9yRWFjaChleGlzdGluZ01hcHBpbmdzLCBmdW5jdGlvbihuZXdOYW1lLCBvbGROYW1lKSB7XHJcbiAgICAgICAgIHJlbmFtZUNvbHVtbihvbGROYW1lLCBuZXdOYW1lKTtcclxuICAgICAgfSk7XHJcbiAgICAgIGZvciAodmFyIGN1cnJlbnRDYXNlIGluIGNhc2VzKSB7XHJcbiAgICAgICAgIGlkZW50aWZ5TG9uZ05hbWVzKGNhc2VzW2N1cnJlbnRDYXNlXSk7XHJcbiAgICAgIH1cclxuICAgICAgcXVlc3Rpb25Ob3JtYWxpemF0aW9uLmFkZE1hcHBpbmdzKGVsbGlwc2VzVG9Ob25FbGxpcHNpcyk7XHJcbiAgIH1cclxuXHJcbiAgIHZhciBlbGxpcHNlc1RvTm9uRWxsaXBzaXMgPSB7fTtcclxuXHJcbiAgIGZ1bmN0aW9uIGlkZW50aWZ5TG9uZ05hbWVzKGN1cnJlbnRDYXNlKSB7XHJcbiAgICAgIGZ1bmN0aW9uIGNhbGN1bGF0ZUxvbmdWZXJzaW9uKGFiYnJldmlhdGVkUXVlc3Rpb25JZCkge1xyXG4gICAgICAgICBpZiAoIXF1ZXN0aW9uSWQuZW5kc1dpdGgoJy4uLicpKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgfVxyXG5cclxuICAgICAgICAgaWYgKGFiYnJldmlhdGVkUXVlc3Rpb25JZCBpbiBlbGxpcHNlc1RvTm9uRWxsaXBzaXMpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICB9XHJcblxyXG4gICAgICAgICB2YXIgcmVtb3ZlZEVsbGlwc2VzID0gYWJicmV2aWF0ZWRRdWVzdGlvbklkLnN1YnN0cmluZygwLCBhYmJyZXZpYXRlZFF1ZXN0aW9uSWQubGVuZ3RoIC0gMyk7XHJcbiAgICAgICAgIHZhciB3YXNTZXQgPSBmYWxzZTtcclxuICAgICAgICAgZm9yICh2YXIgb3RoZXJJZCBpbiBjdXJyZW50Q2FzZSkge1xyXG4gICAgICAgICAgICBpZiAob3RoZXJJZC5zdGFydHNXaXRoKHJlbW92ZWRFbGxpcHNlcykgJiYgb3RoZXJJZCAhPT0gYWJicmV2aWF0ZWRRdWVzdGlvbklkKSB7XHJcbiAgICAgICAgICAgICAgIGVsbGlwc2VzVG9Ob25FbGxpcHNpc1thYmJyZXZpYXRlZFF1ZXN0aW9uSWRdID0gb3RoZXJJZDtcclxuICAgICAgICAgICAgICAgd2FzU2V0ID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBmb3IgKHZhciBxdWVzdGlvbklkIGluIGN1cnJlbnRDYXNlKSB7XHJcbiAgICAgICAgIGNhbGN1bGF0ZUxvbmdWZXJzaW9uKHF1ZXN0aW9uSWQpO1xyXG4gICAgICB9XHJcbiAgIH1cclxuXHJcbiAgIHF1ZXN0aW9uTm9ybWFsaXphdGlvbi5hZGRSZW1hcHBpbmdDYWxsYmFjayhyZW5hbWVDb2x1bW4pO1xyXG4gICBmdW5jdGlvbiByZW5hbWVDb2x1bW4ob2xkS2V5LCBuZXdLZXkpIHtcclxuICAgICAgZm9yICh2YXIgY2FzZUlkIGluIGNhc2VzKSB7XHJcbiAgICAgICAgIHZhciBjYXNlT2JqZWN0ID0gY2FzZXNbY2FzZUlkXTtcclxuICAgICAgICAgcmVtYXBDYXNlQ29sdW1uTmFtZXMob2xkS2V5LCBuZXdLZXksIGNhc2VPYmplY3QsIGNhc2VJZCk7XHJcbiAgICAgIH1cclxuICAgfVxyXG5cclxuICAgZnVuY3Rpb24gcmVtYXBDYXNlQ29sdW1uTmFtZXMob2xkTmFtZSwgdXBkYXRlZE5hbWUsIGNhc2VPYmplY3QsIGNhc2VJZCkge1xyXG4gICAgICB2YXIgb2xkVmFsdWUgPSBjYXNlT2JqZWN0W29sZE5hbWVdO1xyXG4gICAgICBpZiAoIW9sZFZhbHVlKSB7XHJcbiAgICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICB2YXIgYWxyZWFkeVJlbWFwcGVkVmFsdWUgPSBjYXNlT2JqZWN0W3VwZGF0ZWROYW1lXTtcclxuXHJcbiAgICAgIGRlbGV0ZSBjYXNlT2JqZWN0W29sZE5hbWVdO1xyXG5cclxuICAgICAgdmFyIHByZWZlck9sZFZhbHVlID0gIWFscmVhZHlSZW1hcHBlZFZhbHVlIHx8IGFscmVhZHlSZW1hcHBlZFZhbHVlLnZhbHVlID09PSBcIlwiO1xyXG4gICAgICBpZiAocHJlZmVyT2xkVmFsdWUpIHtcclxuICAgICAgICAgY2FzZU9iamVjdFt1cGRhdGVkTmFtZV0gPSBvbGRWYWx1ZTtcclxuICAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB2YXIga2VlcFVwZGF0ZWRWYWx1ZSA9IGFuZ3VsYXIuZXF1YWxzKGFscmVhZHlSZW1hcHBlZFZhbHVlLCBvbGRWYWx1ZSkgfHwgb2xkVmFsdWUudmFsdWUgPT09IFwiXCI7XHJcbiAgICAgIGlmIChrZWVwVXBkYXRlZFZhbHVlKSB7XHJcbiAgICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coXCJVbmFibGUgdG8gZml4IGNhc2UgXCIsIGNhc2VJZCwgXCIgZm9yOiBcIiwgb2xkTmFtZSk7XHJcbiAgICAgIGNhc2VPYmplY3RbdXBkYXRlZE5hbWVdLnN0YXR1cyA9ICAwO1xyXG4gICB9XHJcblxyXG5cclxuXHJcbiAgIHJldHVybiB7XHJcbiAgICAgIGdldENhc2U6IGZ1bmN0aW9uIChjYXNlS2V5KSB7XHJcbiAgICAgICAgIGlmICghKGNhc2VLZXkgaW4gY2FzZXMpKSB7XHJcbiAgICAgICAgICAgIGNhc2VzW2Nhc2VLZXldID0ge307XHJcbiAgICAgICAgIH1cclxuICAgICAgICAgcmV0dXJuIGNhc2VzW2Nhc2VLZXldO1xyXG4gICAgICB9LFxyXG4gICAgICBnZXREYXRhRm9yU2F2aW5nOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgdmFyIGtleU1hcHMgPSBnZW5lcmF0ZUtleU1hcHMoKTtcclxuICAgICAgICAgdmFyIGZ1bGxUb1Nob3J0S2V5TWFwID0ga2V5TWFwcy5mdWxsVG9TaG9ydEtleU1hcDtcclxuICAgICAgICAgdmFyIHNob3J0VG9GdWxsS2V5TWFwID0ga2V5TWFwcy5zaG9ydFRvRnVsbEtleU1hcDtcclxuICAgICAgICAgdmFyIHNob3J0TWFwcGVkRGF0YSA9IHt9O1xyXG4gICAgICAgICBmb3IgKHZhciBjYXNlSWQgaW4gY2FzZXMpIHtcclxuICAgICAgICAgICAgc2hvcnRNYXBwZWREYXRhW2Nhc2VJZF0gPSBrZXlSZW1hcHBlci5yZW1hcEtleXMoZnVsbFRvU2hvcnRLZXlNYXAsIGNhc2VzW2Nhc2VJZF0pO1xyXG4gICAgICAgICB9XHJcbiAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIGRhdGE6IHNob3J0TWFwcGVkRGF0YSxcclxuICAgICAgICAgICAga2V5TWFwOiBzaG9ydFRvRnVsbEtleU1hcFxyXG4gICAgICAgICB9O1xyXG4gICAgICB9LFxyXG4gICAgICBpbXBvcnRSYXdEYXRhOiBpbXBvcnRSYXdEYXRhLFxyXG4gICAgICBzZXREYXRhRnJvbUxvYWRpbmc6IGZ1bmN0aW9uKGFyYml0cmF0aW9uVmFsdWVzKSB7XHJcbiAgICAgICAgIHZhciB1bm1hcHBlZENhc2VzID0gYXJiaXRyYXRpb25WYWx1ZXMuZGF0YTtcclxuICAgICAgICAgdmFyIHNob3J0VG9GdWxsS2V5TWFwID0gYXJiaXRyYXRpb25WYWx1ZXMua2V5TWFwO1xyXG4gICAgICAgICBmb3IgKHZhciBjYXNlSWQgaW4gdW5tYXBwZWRDYXNlcykge1xyXG4gICAgICAgICAgICBjYXNlc1tjYXNlSWRdID0ga2V5UmVtYXBwZXIucmVtYXBLZXlzKHNob3J0VG9GdWxsS2V5TWFwLCB1bm1hcHBlZENhc2VzW2Nhc2VJZF0pO1xyXG4gICAgICAgICB9XHJcbiAgICAgICAgIG5vcm1hbGl6ZUtleXMoKTtcclxuICAgICAgICAgbG9hZENvbXBsZXRlQ2FsbGJhY2tzLmZpcmUoKTtcclxuICAgICAgfSxcclxuICAgICAgZ2V0RXhwb3J0RGF0YTogZ2V0RXhwb3J0RGF0YSxcclxuICAgICAgaXNGdWxseUFyYml0cmF0ZWQ6IGlzRnVsbHlBcmJpdHJhdGVkLFxyXG4gICAgICBpc1BhcnRpYWxseUFyYml0cmF0ZWQ6IGlzUGFydGlhbGx5QXJiaXRyYXRlZCxcclxuICAgICAgYWRkTG9hZENvbXBsZXRlQ2FsbGJhY2s6IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XHJcbiAgICAgICAgIGxvYWRDb21wbGV0ZUNhbGxiYWNrcy5hZGQoY2FsbGJhY2spO1xyXG4gICAgICB9LFxyXG4gICB9XHJcblxyXG59XSk7IiwiYXBwLmNvbnRyb2xsZXIoJ2Nhc2VDb250cm9sbGVyJywgWyckc2NvcGUnLCAnQ2FzZScsICdjb2RlckRhdGEnLCAnYXJiaXRyYXRvckRhdGEnLCAnUHJvamVjdCcsICdjYXNlSW5mb1NlcnZpY2UnLCAnc2lkZWJhclJlZnJlc2hTZXJ2aWNlJyxcclxuICAgZnVuY3Rpb24oJHNjb3BlLCBDYXNlLCBjb2RlckRhdGEsIGFyYml0cmF0b3JEYXRhLCBQcm9qZWN0LCBjYXNlSW5mb1NlcnZpY2UsIHNpZGViYXJSZWZyZXNoU2VydmljZSkge1xyXG5cclxuICAgQ2FzZS5zdWJzY3JpYmUob25TZXRDYXNlKTtcclxuXHJcbiAgIGxldCBTdGF0dXMgPSB7XHJcbiAgICAgIE5vdEFyYml0cmF0ZWQ6IDAsXHJcbiAgICAgIEFyYml0cmF0ZWQ6IDFcclxuICAgfTtcclxuXHJcbiAgICRzY29wZS5oaWRlQXJiaXRyYXRlZCA9IHtcclxuICAgICAgdmFsdWU6IGZhbHNlXHJcbiAgIH07XHJcblxyXG4gICAkc2NvcGUuaGlkZUJsYW5rcyA9IHtcclxuICAgICAgdmFsdWU6IGZhbHNlXHJcbiAgIH07XHJcblxyXG4gICBvblNldENhc2UoQ2FzZS5nZXRDdXJyZW50KCkpO1xyXG5cclxuICAgZnVuY3Rpb24gb25TZXRDYXNlKGNhc2VJZCkge1xyXG4gICAgICBsZXQgY2FzZURhdGEgPSBjb2RlckRhdGEuZ2V0Q2FzZShjYXNlSWQpO1xyXG5cclxuICAgICAgY29uc3QgcHJvamVjdCA9IFByb2plY3QuZ2V0KCk7XHJcblxyXG4gICAgICBjb25zdCBhbGxDYXNlSW5mb3MgPSBwcm9qZWN0LmNhc2VJbmZvO1xyXG4gICAgICAkc2NvcGUuY2FzZUluZm8gPSBhbGxDYXNlSW5mb3NbY2FzZUlkXSB8fCB7XHJcbiAgICAgICAgIG5vdGVzOiBcIlwiLFxyXG4gICAgICAgICBmbGFnOiAwLFxyXG4gICAgICB9O1xyXG4gICAgICBhbGxDYXNlSW5mb3NbY2FzZUlkXSA9ICRzY29wZS5jYXNlSW5mbztcclxuXHJcbiAgICAgICRzY29wZS5jYXNlSWQgPSBjYXNlSWQ7XHJcbiAgICAgIGNvbnN0IGNvZGVyS2V5cyA9IE9iamVjdC5rZXlzKGNhc2VEYXRhKTtcclxuXHJcbiAgICAgICRzY29wZS5jb2RlcjFOYW1lID0gY29kZXJLZXlzWzBdO1xyXG4gICAgICAkc2NvcGUuY29kZXIxID0gY2FzZURhdGFbJHNjb3BlLmNvZGVyMU5hbWVdO1xyXG5cclxuICAgICAgaWYgKGNvZGVyS2V5cy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgICRzY29wZS5jb2RlcjJOYW1lID0gY29kZXJLZXlzWzFdO1xyXG4gICAgICAgICAkc2NvcGUuY29kZXIyID0gY2FzZURhdGFbJHNjb3BlLmNvZGVyMk5hbWVdO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAkc2NvcGUuY29kZXIyTmFtZSA9IFwiTm9uZVwiO1xyXG4gICAgICAgICAkc2NvcGUuY29kZXIyID0ge307XHJcbiAgICAgIH1cclxuXHJcbiAgICAgICRzY29wZS5leHBhbmRlZFJvd3MgPSB7fTtcclxuICAgICAgJHNjb3BlLnF1ZXN0aW9uSWRzID0gT2JqZWN0LmtleXMoJHNjb3BlLmNvZGVyMSk7XHJcblxyXG4gICAgICAkc2NvcGUuY2FzZVRpdGxlID0gY2FzZUluZm9TZXJ2aWNlLmdldEZ1bGxUaXRsZShjYXNlSWQpO1xyXG5cclxuXHJcbiAgICAgIGxvYWRBcmJpdHJhdGVkRGF0YShjYXNlSWQpO1xyXG4gICAgICBndWVzc0FyYml0cmF0ZWREYXRhKCk7XHJcbiAgIH1cclxuXHJcbiAgIGZ1bmN0aW9uIGxvYWRBcmJpdHJhdGVkRGF0YShjYXNlSWQpIHtcclxuICAgICAgbGV0IHN0b3JlZEFyYml0cmF0aW9uICA9IGFyYml0cmF0b3JEYXRhLmdldENhc2UoY2FzZUlkKTtcclxuICAgICAgYW5ndWxhci5mb3JFYWNoKCRzY29wZS5xdWVzdGlvbklkcywgZnVuY3Rpb24ocXVlc3Rpb25JZCkge1xyXG4gICAgICAgICBpZiAoYW5ndWxhci5pc1VuZGVmaW5lZChzdG9yZWRBcmJpdHJhdGlvbltxdWVzdGlvbklkXSkpIHtcclxuICAgICAgICAgICAgc3RvcmVkQXJiaXRyYXRpb25bcXVlc3Rpb25JZF0gPSAge3ZhbHVlOiBcIlwiLCBzdGF0dXM6U3RhdHVzLk5vdEFyYml0cmF0ZWR9O1xyXG4gICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICAkc2NvcGUuYXJiaXRyYXRvciA9IHN0b3JlZEFyYml0cmF0aW9uO1xyXG4gICB9XHJcblxyXG4gICBmdW5jdGlvbiBndWVzc0FyYml0cmF0ZWREYXRhKCkge1xyXG4gICAgICAvLyBUT0RPOiBGaWxsIGluIGFyYml0cmF0b3IuXHJcbiAgIH1cclxuXHJcbiAgIGZ1bmN0aW9uIGdldFF1ZXN0aW9uc1RvUmVzb2x2ZSgpIHtcclxuICAgICAgcmV0dXJuICRzY29wZS5xdWVzdGlvbklkcy5maWx0ZXIoZnVuY3Rpb24ocXVlc3Rpb25JZCkge1xyXG4gICAgICAgICBsZXQgYWxyZWFkeUFyYml0cmF0ZWQgPSAkc2NvcGUuYXJiaXRyYXRvcltxdWVzdGlvbklkXSAmJiAkc2NvcGUuYXJiaXRyYXRvcltxdWVzdGlvbklkXS5zdGF0dXM7XHJcbiAgICAgICAgIHJldHVybiAhYWxyZWFkeUFyYml0cmF0ZWQgJiYgJHNjb3BlLmNvZGVyMVtxdWVzdGlvbklkXSA9PT0gJHNjb3BlLmNvZGVyMltxdWVzdGlvbklkXTtcclxuICAgICAgfSlcclxuICAgfVxyXG5cclxuICAgJHNjb3BlLmF1dG9SZXNvbHZlID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgIGxldCBxdWVzdGlvbnMgPSBnZXRRdWVzdGlvbnNUb1Jlc29sdmUoKTtcclxuICAgICAgcXVlc3Rpb25zLmZvckVhY2goZnVuY3Rpb24ocXVlc3Rpb25JZCkge1xyXG4gICAgICAgICAkc2NvcGUuYXJiaXRyYXRvcltxdWVzdGlvbklkXS52YWx1ZSA9ICRzY29wZS5jb2RlcjFbcXVlc3Rpb25JZF07XHJcbiAgICAgICAgICRzY29wZS5hcmJpdHJhdG9yW3F1ZXN0aW9uSWRdLnN0YXR1cyA9IFN0YXR1cy5BcmJpdHJhdGVkO1xyXG4gICAgICB9KTtcclxuICAgICAgUHJvamVjdC5tYXJrRGlydHkoKTtcclxuICAgICAgc2lkZWJhclJlZnJlc2hTZXJ2aWNlLnRyaWdnZXJSZWZyZXNoKCRzY29wZS5jYXNlSWQpO1xyXG4gICB9O1xyXG5cclxuICAgJHNjb3BlLmNhbkF1dG9SZXNvbHZlID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgIHJldHVybiBnZXRRdWVzdGlvbnNUb1Jlc29sdmUoKS5sZW5ndGggPiAwO1xyXG4gICB9O1xyXG5cclxuICAgJHNjb3BlLnByb2dyZXNzID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgIGxldCBhcmJpdHJhdGVkQ291bnQgPSAwO1xyXG4gICAgICBhbmd1bGFyLmZvckVhY2goJHNjb3BlLnF1ZXN0aW9uSWRzLCBmdW5jdGlvbihxdWVzdGlvbklkKSB7XHJcbiAgICAgICAgIGlmICgkc2NvcGUuaXNBcmJpdHJhdGVkKHF1ZXN0aW9uSWQpKSB7XHJcbiAgICAgICAgICAgIGFyYml0cmF0ZWRDb3VudCsrO1xyXG4gICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICByZXR1cm4gTWF0aC5mbG9vcigxMDAgKiBhcmJpdHJhdGVkQ291bnQgLyAkc2NvcGUucXVlc3Rpb25JZHMubGVuZ3RoKTtcclxuICAgfTtcclxuXHJcbiAgICRzY29wZS5pc0VxdWl2YWxlbnQgPSBmdW5jdGlvbihxdWVzdGlvbklkKSB7XHJcbiAgICAgIGxldCB2YWx1ZTEgPSAkc2NvcGUuY29kZXIxW3F1ZXN0aW9uSWRdO1xyXG4gICAgICBsZXQgdmFsdWUyID0gJHNjb3BlLmNvZGVyMltxdWVzdGlvbklkXTtcclxuICAgICAgcmV0dXJuIHZhbHVlMSA9PT0gdmFsdWUyO1xyXG4gICB9O1xyXG5cclxuICAgJHNjb3BlLmlzQXJiaXRyYXRlZCA9IGZ1bmN0aW9uKHF1ZXN0aW9uSWQpIHtcclxuICAgICAgcmV0dXJuICRzY29wZS5hcmJpdHJhdG9yW3F1ZXN0aW9uSWRdLnN0YXR1cyA9PT0gU3RhdHVzLkFyYml0cmF0ZWQ7XHJcbiAgIH07XHJcblxyXG4gICAkc2NvcGUuaXNCbGFuayA9IGZ1bmN0aW9uKHF1ZXN0aW9uSWQpIHtcclxuICAgICAgcmV0dXJuICRzY29wZS5jb2RlcjFbcXVlc3Rpb25JZF0gPT09IFwiXCIgJiYgJHNjb3BlLmNvZGVyMltxdWVzdGlvbklkXSA9PT0gXCJcIjtcclxuICAgfVxyXG5cclxuICAgZnVuY3Rpb24gc2V0QXJiaXRyYXRlZChxdWVzdGlvbklkLCB2YWx1ZSkge1xyXG4gICAgICAkc2NvcGUuYXJiaXRyYXRvcltxdWVzdGlvbklkXS5zdGF0dXMgPSB2YWx1ZTtcclxuICAgICAgUHJvamVjdC5tYXJrRGlydHkoKTtcclxuICAgICAgc2lkZWJhclJlZnJlc2hTZXJ2aWNlLnRyaWdnZXJSZWZyZXNoKCRzY29wZS5jYXNlSWQpO1xyXG4gICB9XHJcblxyXG4gICAkc2NvcGUuZGlzYWJsZUFyYml0cmF0aW9uID0gZnVuY3Rpb24ocXVlc3Rpb25JZCkge1xyXG4gICAgICBzZXRBcmJpdHJhdGVkKHF1ZXN0aW9uSWQsIFN0YXR1cy5Ob3RBcmJpdHJhdGVkKVxyXG4gICB9O1xyXG5cclxuICAgJHNjb3BlLmVuYWJsZUFyYml0cmF0aW9uID0gZnVuY3Rpb24ocXVlc3Rpb25JZCkge1xyXG4gICAgICBzZXRBcmJpdHJhdGVkKHF1ZXN0aW9uSWQsIFN0YXR1cy5BcmJpdHJhdGVkKTtcclxuICAgfTtcclxuXHJcbiAgICRzY29wZS5vbkFyYml0cmF0aW9uQ2hhbmdlID0gZnVuY3Rpb24ocXVlc3Rpb25JZCkge1xyXG4gICAgICAkc2NvcGUuZGlzYWJsZUFyYml0cmF0aW9uKHF1ZXN0aW9uSWQpO1xyXG4gICAgICBQcm9qZWN0Lm1hcmtEaXJ0eSgpO1xyXG4gICAgICBzaWRlYmFyUmVmcmVzaFNlcnZpY2UudHJpZ2dlclJlZnJlc2goJHNjb3BlLmNhc2VJZCk7XHJcbiAgIH07XHJcblxyXG4gICAkc2NvcGUudG9nZ2xlQXJiaXRyYXRpb24gPSBmdW5jdGlvbihxdWVzdGlvbklkKSB7XHJcbiAgICAgIGlmICgkc2NvcGUuaXNBcmJpdHJhdGVkKHF1ZXN0aW9uSWQpKSB7XHJcbiAgICAgICAgICRzY29wZS5kaXNhYmxlQXJiaXRyYXRpb24ocXVlc3Rpb25JZCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICRzY29wZS5lbmFibGVBcmJpdHJhdGlvbihxdWVzdGlvbklkKTtcclxuICAgICAgfVxyXG4gICB9O1xyXG5cclxuICAgJHNjb3BlLmFjY2VwdENvZGVyID0gZnVuY3Rpb24ocXVlc3Rpb25JZCwgY29kZXIpIHtcclxuICAgICAgJHNjb3BlLmFyYml0cmF0b3JbcXVlc3Rpb25JZF0udmFsdWUgPSBjb2RlcltxdWVzdGlvbklkXTtcclxuICAgICAgc2V0QXJiaXRyYXRlZChxdWVzdGlvbklkLCBTdGF0dXMuQXJiaXRyYXRlZCk7XHJcbiAgIH1cclxuXHJcbiAgICRzY29wZS5jeWNsZUZsYWcgPSBmdW5jdGlvbigpIHtcclxuICAgICAgY29uc3QgbnVtRmxhZ3MgPSA0O1xyXG4gICAgICAkc2NvcGUuY2FzZUluZm8uZmxhZyA9ICgkc2NvcGUuY2FzZUluZm8uZmxhZyArIDEpICUgbnVtRmxhZ3M7XHJcbiAgICAgIFByb2plY3QubWFya0RpcnR5KCk7XHJcbiAgICAgIHNpZGViYXJSZWZyZXNoU2VydmljZS50cmlnZ2VyUmVmcmVzaCgkc2NvcGUuY2FzZUlkKTtcclxuICAgfVxyXG59XSk7XHJcblxyXG4iLCJhcHAuZmFjdG9yeSgnY2FzZUluZm9TZXJ2aWNlJywgWydQcm9qZWN0JywgJ2NvZGVyRGF0YScsIGZ1bmN0aW9uKFByb2plY3QsIGNvZGVyRGF0YSkge1xyXG5cclxuICAgZnVuY3Rpb24gZ2V0RnVsbFRpdGxlKGNhc2VJZCkge1xyXG4gICAgICBjb25zdCBjYXNlRGF0YSA9IGNvZGVyRGF0YS5nZXRDYXNlKGNhc2VJZCk7XHJcbiAgICAgIGNvbnN0IGNvZGVyS2V5cyA9IE9iamVjdC5rZXlzKGNhc2VEYXRhKTtcclxuICAgICAgY29uc3QgZmlyc3RDb2RlckRhdGEgPSBjYXNlRGF0YVtjb2RlcktleXNbMF1dXHJcbiAgICAgIGNvbnN0IHRpdGxlRnJvbUhlYWRlcnMgPSBQcm9qZWN0LmdldCgpLmludmFyaWF0ZUhlYWRlcnMubWFwKChxdWVzdGlvbklkKSA9PiB7XHJcbiAgICAgICAgIHJldHVybiBmaXJzdENvZGVyRGF0YVtxdWVzdGlvbklkXVxyXG4gICAgICB9KS5qb2luKCcgJyk7XHJcbiAgICAgIHJldHVybiBgQ2FzZSAke2Nhc2VJZH0gfCAke3RpdGxlRnJvbUhlYWRlcnN9YFxyXG4gICB9XHJcblxyXG4gICBmdW5jdGlvbiBnZXRGbGFnKGNhc2VJZCkge1xyXG4gICAgICBjb25zdCBjYXNlSW5mbyA9IFByb2plY3QuZ2V0KCkuY2FzZUluZm9bY2FzZUlkXTtcclxuICAgICAgcmV0dXJuIGNhc2VJbmZvID8gY2FzZUluZm8uZmxhZyA6IDA7XHJcbiAgIH1cclxuXHJcbiAgIHJldHVybiB7XHJcbiAgICAgIGdldEZ1bGxUaXRsZTogZ2V0RnVsbFRpdGxlLFxyXG4gICAgICBnZXRGbGFnOiBnZXRGbGFnLFxyXG4gICB9XHJcbn1dKTsiLCJhcHAuZmFjdG9yeSgnY29kZXJEYXRhJywgWydxdWVzdGlvbk5vcm1hbGl6YXRpb24nLCAna2V5UmVtYXBwZXInLCAncXVlc3Rpb25Tb3J0ZXInLFxyXG4gZnVuY3Rpb24ocXVlc3Rpb25Ob3JtYWxpemF0aW9uLCBrZXlSZW1hcHBlciwgcXVlc3Rpb25Tb3J0ZXIpIHtcclxuICAgdmFyIGNhc2VzID0ge307XHJcbiAgIHZhciBsb2FkQ29tcGxldGVDYWxsYmFja3MgPSBqUXVlcnkuQ2FsbGJhY2tzKCk7XHJcblxyXG4gICBmdW5jdGlvbiBpbXBvcnRDYXNlRGF0YShjb2RlcklkLCBwYXJzZWREYXRhKSB7XHJcbiAgICAgIGZvciAodmFyIGNhc2VJZCBpbiBwYXJzZWREYXRhKSB7XHJcbiAgICAgICAgIGlmICghY2FzZXNbY2FzZUlkXSkge1xyXG4gICAgICAgICAgICBjYXNlc1tjYXNlSWRdID0ge307XHJcbiAgICAgICAgIH1cclxuICAgICAgICAgY2FzZXNbY2FzZUlkXVtjb2RlcklkXSA9IHBhcnNlZERhdGFbY2FzZUlkXTtcclxuICAgICAgfVxyXG4gICB9XHJcblxyXG4gICBmdW5jdGlvbiB0cmltV2hpdGVzcGFjZUluVmFsdWVzKGNhc2VPYmplY3QpIHtcclxuICAgICAgZm9yICh2YXIga2V5IGluIGNhc2VPYmplY3QpIHtcclxuICAgICAgICAgY2FzZU9iamVjdFtrZXldID0gY2FzZU9iamVjdFtrZXldLnRyaW0oKTtcclxuICAgICAgfVxyXG4gICB9XHJcblxyXG4gICBmdW5jdGlvbiBpbXBvcnRSYXdEYXRhKGZpbGVDb250ZW50cywgY2FzZUlkS2V5LCBjb2RlcklkS2V5KSB7XHJcbiAgICAgIHZhciBwYXJzZWRDb250ZW50cyA9IFBhcGEucGFyc2UoZmlsZUNvbnRlbnRzLCB7aGVhZGVyOiB0cnVlfSk7XHJcbiAgICAgIHZhciBwYXJzZWREYXRhID0ge307XHJcbiAgICAgIHZhciBjb2RlcklkID0gcGFyc2VkQ29udGVudHMuZGF0YVswXVtjb2RlcklkS2V5XTtcclxuXHJcbiAgICAgIHZhciBleGlzdGluZ01hcHBpbmdzID0gcXVlc3Rpb25Ob3JtYWxpemF0aW9uLmdldEN1cnJlbnRNYXAoKTtcclxuICAgICAgcGFyc2VkQ29udGVudHMuZGF0YS5mb3JFYWNoKGZ1bmN0aW9uIChjYXNlT2JqZWN0KSB7XHJcbiAgICAgICAgIHZhciBjYXNlSWQgPSBjYXNlT2JqZWN0W2Nhc2VJZEtleV07XHJcbiAgICAgICAgIHRyaW1XaGl0ZXNwYWNlSW5WYWx1ZXMoY2FzZU9iamVjdCk7XHJcbiAgICAgICAgIHZhciBub3JtYWxpemVkQ2FzZU9iamVjdCA9IGtleVJlbWFwcGVyLnJlbWFwS2V5cyhleGlzdGluZ01hcHBpbmdzLCBjYXNlT2JqZWN0KTtcclxuICAgICAgICAgcGFyc2VkRGF0YVtjYXNlSWRdID0gbm9ybWFsaXplZENhc2VPYmplY3Q7XHJcbiAgICAgIH0pO1xyXG4gICAgICBpbXBvcnRDYXNlRGF0YShjb2RlcklkLCBwYXJzZWREYXRhKTtcclxuICAgICAgbG9hZENvbXBsZXRlQ2FsbGJhY2tzLmZpcmUoKTtcclxuICAgfVxyXG5cclxuICAgcXVlc3Rpb25Ob3JtYWxpemF0aW9uLmFkZFJlbWFwcGluZ0NhbGxiYWNrKHJlbmFtZUNvbHVtbik7XHJcbiAgIGZ1bmN0aW9uIHJlbmFtZUNvbHVtbihvbGROYW1lLCBuZXdOYW1lKSB7XHJcbiAgICAgIF8uZm9yRWFjaChjYXNlcywgZnVuY3Rpb24oY2FzZU9iamVjdCkge1xyXG4gICAgICAgICBfLmZvckVhY2goY2FzZU9iamVjdCwgZnVuY3Rpb24oY29kZXJPYmplY3QpIHtcclxuICAgICAgICAgICAgY29kZXJPYmplY3RbbmV3TmFtZV0gPSBjb2Rlck9iamVjdFtvbGROYW1lXTtcclxuICAgICAgICAgICAgZGVsZXRlIGNvZGVyT2JqZWN0W29sZE5hbWVdO1xyXG4gICAgICAgICB9KTtcclxuICAgICAgfSlcclxuICAgfVxyXG5cclxuICAgZnVuY3Rpb24gZ2V0UmVsaWFiaWxpdHkoKSB7XHJcbiAgICAgIHZhciBxdWVzdGlvbklkcyA9IHF1ZXN0aW9uU29ydGVyLmdldFNvcnRlZEtleXMoY2FzZXMsIDIpXHJcbiAgICAgIHZhciBoZWFkZXJSb3cgPSBbJ0Nhc2UgSWQnXS5jb25jYXQocXVlc3Rpb25JZHMpO1xyXG4gICAgICBoZWFkZXJSb3cucHVzaCgnQ2FzZSBBdmVyYWdlJyk7XHJcbiAgICAgIHZhciBvdXRwdXQgPSBbaGVhZGVyUm93XTtcclxuXHJcbiAgICAgIHZhciBxdWVzdGlvbk1hdGNoQ291bnRzID0ge307XHJcbiAgICAgIF8uZm9yRWFjaChxdWVzdGlvbklkcywgZnVuY3Rpb24ocXVlc3Rpb25JZCkge1xyXG4gICAgICAgICBxdWVzdGlvbk1hdGNoQ291bnRzW3F1ZXN0aW9uSWRdID0gMDtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICB2YXIgZG91YmxlQ291bnRlZENvdW50ID0gMDtcclxuICAgICAgXy5mb3JFYWNoKGNhc2VzLCBmdW5jdGlvbihjYXNlT2JqZWN0LCBjYXNlSWQpIHtcclxuICAgICAgICAgdmFyIGNvZGVyS2V5cyA9IE9iamVjdC5rZXlzKGNhc2VPYmplY3QpO1xyXG4gICAgICAgICB2YXIgY29kZXIxID0gY2FzZU9iamVjdFtjb2RlcktleXNbMF1dO1xyXG5cclxuICAgICAgICAgdmFyIHJvdyA9IFtjYXNlSWRdO1xyXG4gICAgICAgICBpZiAoY29kZXJLZXlzLmxlbmd0aCA9PT0gMikge1xyXG4gICAgICAgICAgICBkb3VibGVDb3VudGVkQ291bnQgKz0gMTtcclxuICAgICAgICAgICAgdmFyIGNvZGVyMiA9IGNhc2VPYmplY3RbY29kZXJLZXlzWzFdXTtcclxuICAgICAgICAgICAgdmFyIGNhc2VNYXRjaENvdW50ID0gMDtcclxuICAgICAgICAgICAgXy5mb3JFYWNoKHF1ZXN0aW9uSWRzLCBmdW5jdGlvbihxdWVzdGlvbklkKSB7XHJcbiAgICAgICAgICAgICAgIHZhciBtYXRjaFZhbHVlID0gY29kZXIxW3F1ZXN0aW9uSWRdID09PSBjb2RlcjJbcXVlc3Rpb25JZF0gPyAxIDogMDtcclxuICAgICAgICAgICAgICAgY2FzZU1hdGNoQ291bnQgKz0gbWF0Y2hWYWx1ZTtcclxuICAgICAgICAgICAgICAgcXVlc3Rpb25NYXRjaENvdW50c1txdWVzdGlvbklkXSArPSBtYXRjaFZhbHVlO1xyXG4gICAgICAgICAgICAgICByb3cucHVzaChtYXRjaFZhbHVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJvdy5wdXNoKGNhc2VNYXRjaENvdW50IC8gcXVlc3Rpb25JZHMubGVuZ3RoKTtcclxuICAgICAgICAgfVxyXG5cclxuICAgICAgICAgb3V0cHV0LnB1c2gocm93KTtcclxuICAgICAgfSlcclxuXHJcbiAgICAgIHZhciB0b3RhbFJvdyA9IFsnUXVlc3Rpb24gQXZlcmFnZSddO1xyXG4gICAgICBfLmZvckVhY2gocXVlc3Rpb25JZHMsIGZ1bmN0aW9uKHF1ZXN0aW9uSWQpIHtcclxuICAgICAgICAgdmFyIHF1ZXN0aW9uTWF0Y2hDb3VudCA9IHF1ZXN0aW9uTWF0Y2hDb3VudHNbcXVlc3Rpb25JZF1cclxuICAgICAgICAgdG90YWxSb3cucHVzaChxdWVzdGlvbk1hdGNoQ291bnQgLyBkb3VibGVDb3VudGVkQ291bnQpO1xyXG4gICAgICB9KVxyXG4gICAgICBvdXRwdXQucHVzaCh0b3RhbFJvdyk7XHJcblxyXG4gICAgICByZXR1cm4gb3V0cHV0O1xyXG4gICB9XHJcblxyXG4gICByZXR1cm4ge1xyXG4gICAgICBnZXRDYXNlOiBmdW5jdGlvbiAoY2FzZUlkKSB7XHJcbiAgICAgICAgIHJldHVybiBjYXNlc1tjYXNlSWRdO1xyXG4gICAgICB9LFxyXG4gICAgICBnZXRDYXNlczogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgIHJldHVybiBjYXNlcztcclxuICAgICAgfSxcclxuICAgICAgaW1wb3J0UmF3RGF0YTogaW1wb3J0UmF3RGF0YSxcclxuICAgICAgYWRkTG9hZENvbXBsZXRlQ2FsbGJhY2s6IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XHJcbiAgICAgICAgIGxvYWRDb21wbGV0ZUNhbGxiYWNrcy5hZGQoY2FsbGJhY2spO1xyXG4gICAgICB9LFxyXG4gICAgICBnZXRSZWxpYWJpbGl0eTogZ2V0UmVsaWFiaWxpdHksXHJcbiAgIH1cclxufV0pO1xyXG4iLCJhcHAuZmFjdG9yeSgnZGlzaycsIFsnUHJvamVjdCcsICdhcmJpdHJhdG9yRGF0YScsICdxdWVzdGlvbk5vcm1hbGl6YXRpb24nLCAnY29kZXJEYXRhJyxcclxuZnVuY3Rpb24oUHJvamVjdCwgYXJiaXRyYXRvckRhdGEsIHF1ZXN0aW9uTm9ybWFsaXphdGlvbiwgY29kZXJEYXRhKSB7XHJcblxyXG4gICB2YXIgc2F2YWJsZVNlcnZpY2VzID0ge1xyXG4gICAgICBhcmJpdHJhdG9yOiBhcmJpdHJhdG9yRGF0YSxcclxuICAgICAgcHJvamVjdE1ldGE6IFByb2plY3QsXHJcbiAgICAgIHF1ZXN0aW9uTm9ybWFsaXphdGlvbjogcXVlc3Rpb25Ob3JtYWxpemF0aW9uXHJcbiAgIH07XHJcblxyXG4gICBmdW5jdGlvbiBnZXRGaWxlbmFtZSgpIHtcclxuICAgICAgdmFyIG5hbWUgPSBQcm9qZWN0LmdldCgpLm5hbWUgfHwgJ0FyYml0cmF0aW9uJztcclxuICAgICAgdmFyIGQgPSBuZXcgRGF0ZSgpO1xyXG4gICAgICB2YXIgZGF0ZVN0cmluZyA9ICBkLmdldEZ1bGxZZWFyKCkgKyBcIi1cIiArIChkLmdldE1vbnRoKCkrMSkgKyBcIi1cIiArIGQuZ2V0RGF0ZSgpICsgXCIgXCIgK1xyXG4gICAgICAgICBkLmdldEhvdXJzKCkgKyBcIl9cIiArIGQuZ2V0TWludXRlcygpO1xyXG4gICAgICByZXR1cm4gbmFtZSArIFwiX1wiICsgZGF0ZVN0cmluZ1xyXG4gICB9XHJcblxyXG4gICBmdW5jdGlvbiB3cml0ZVRvRGlzayhzdHJpbmdEYXRhLCBmaWxlbmFtZSkgeyAvLyBha2EgXCJEb3dubG9hZFwiXHJcbiAgICAgIHZhciBhID0gd2luZG93LmRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgICAgYS5ocmVmID0gd2luZG93LlVSTC5jcmVhdGVPYmplY3RVUkwobmV3IEJsb2IoW3N0cmluZ0RhdGFdLCB7dHlwZTogJ3RleHQnfSkpO1xyXG4gICAgICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XHJcblxyXG4gICAgICAvLyBBcHBlbmQgYW5jaG9yIHRvIGJvZHkuXHJcbiAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSlcclxuICAgICAgYS5jbGljaygpO1xyXG5cclxuICAgICAgLy8gUmVtb3ZlIGFuY2hvciBmcm9tIGJvZHlcclxuICAgICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKVxyXG4gICB9XHJcblxyXG4gICBmdW5jdGlvbiBzYXZlKCkge1xyXG4gICAgICBQcm9qZWN0LmNsZWFyRGlydHlGbGFnKCk7XHJcblxyXG4gICAgICB2YXIgcHJvamVjdERhdGEgPSBfLnJlZHVjZShzYXZhYmxlU2VydmljZXMsIGZ1bmN0aW9uKHJlc3VsdCwgc2VydmljZSwgc2VydmljZUtleSkge1xyXG4gICAgICAgICByZXN1bHRbc2VydmljZUtleV0gPSBzZXJ2aWNlLmdldERhdGFGb3JTYXZpbmcoKTtcclxuICAgICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgICAgfSwge30pO1xyXG5cclxuICAgICAgdmFyIGZpbGVuYW1lID0gZ2V0RmlsZW5hbWUoKSArIFwiLmFyYlwiO1xyXG5cclxuICAgICAgdmFyIHByZXR0eSA9IGZhbHNlO1xyXG4gICAgICB2YXIgc3RyaW5nRGF0YSA9IHByZXR0eSA/XHJcbiAgICAgICAgIEpTT04uc3RyaW5naWZ5KHByb2plY3REYXRhLCBudWxsLCAzKSA6XHJcbiAgICAgICAgIEpTT04uc3RyaW5naWZ5KHByb2plY3REYXRhKTtcclxuXHJcbiAgICAgIHdyaXRlVG9EaXNrKHN0cmluZ0RhdGEsIGZpbGVuYW1lKTtcclxuICAgfVxyXG5cclxuICAgZnVuY3Rpb24gbG9hZFByb2plY3QoZmlsZUNvbnRlbnRzKSB7XHJcbiAgICAgIFByb2plY3QuY2xlYXJEaXJ0eUZsYWcoKTtcclxuICAgICAgdmFyIHNhdmVEYXRhID0gSlNPTi5wYXJzZShmaWxlQ29udGVudHMpO1xyXG4gICAgICBfLmVhY2goc2F2ZURhdGEsIGZ1bmN0aW9uKHN0b3JlZFZhbHVlLCBzZXJ2aWNlS2V5KSB7XHJcbiAgICAgICAgIHZhciBzZXJ2aWNlID0gc2F2YWJsZVNlcnZpY2VzW3NlcnZpY2VLZXldO1xyXG4gICAgICAgICBpZiAoc2VydmljZSkge1xyXG4gICAgICAgICAgICBzZXJ2aWNlLnNldERhdGFGcm9tTG9hZGluZyhzdG9yZWRWYWx1ZSk7XHJcbiAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihcIlNraXBwZWQgdmFsdWUgZm9yIFwiICsgc2VydmljZUtleSk7XHJcbiAgICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgIH1cclxuXHJcbiAgIGZ1bmN0aW9uIGV4cG9ydENzdihvbmx5RXhwb3J0RnVsbHlBcmJpdHJhdGVkKSB7XHJcbiAgICAgIHZhciBleHBvcnREYXRhID0gYXJiaXRyYXRvckRhdGEuZ2V0RXhwb3J0RGF0YShvbmx5RXhwb3J0RnVsbHlBcmJpdHJhdGVkKTtcclxuICAgICAgdmFyIHN0cmluZ0RhdGEgPSBQYXBhLnVucGFyc2UoZXhwb3J0RGF0YSwge2RlbGltaXRlcjogJywnfSlcclxuICAgICAgdmFyIGZpbGVuYW1lID0gZ2V0RmlsZW5hbWUoKSArIFwiLmNzdlwiO1xyXG4gICAgICB3cml0ZVRvRGlzayhzdHJpbmdEYXRhLCBmaWxlbmFtZSk7XHJcbiAgIH1cclxuXHJcbiAgIGZ1bmN0aW9uIGV4cG9ydFJlbGlhYmlsaXR5KCkge1xyXG4gICAgICB2YXIgcmVsaWFiaWxpdHlEYXRhID0gY29kZXJEYXRhLmdldFJlbGlhYmlsaXR5KCk7XHJcbiAgICAgIHZhciBzdHJpbmdEYXRhID0gUGFwYS51bnBhcnNlKHJlbGlhYmlsaXR5RGF0YSwge2RlbGltaXRlcjogJywnfSlcclxuICAgICAgdmFyIGZpbGVuYW1lID0gXCJSZWxpYWJpbGl0eV9cIiArIGdldEZpbGVuYW1lKCkgKyBcIi5jc3ZcIlxyXG4gICAgICB3cml0ZVRvRGlzayhzdHJpbmdEYXRhLCBmaWxlbmFtZSk7XHJcbiAgIH1cclxuXHJcbiAgIHJldHVybiB7XHJcbiAgICAgIGxvYWQ6IGxvYWRQcm9qZWN0LFxyXG4gICAgICBzYXZlOiBzYXZlLFxyXG4gICAgICBleHBvcnRDc3Y6IGV4cG9ydENzdixcclxuICAgICAgZXhwb3J0UmVsaWFiaWxpdHk6IGV4cG9ydFJlbGlhYmlsaXR5LFxyXG4gICB9XHJcbn1dKTtcclxuIiwiZnVuY3Rpb24gZXhlY3V0ZUNvbnRlbnRzKCRzY29wZSwgY2FsbGJhY2ssIGZpbGUpIHtcclxuICAgdmFyIHIgPSBuZXcgRmlsZVJlYWRlcigpO1xyXG4gICByLm9ubG9hZCA9IGZ1bmN0aW9uIChlKSB7XHJcbiAgICAgIHZhciBjb250ZW50cyA9IGUudGFyZ2V0LnJlc3VsdDtcclxuICAgICAgJHNjb3BlLiRhcHBseShmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgIGNhbGxiYWNrKGNvbnRlbnRzKTtcclxuICAgICAgfSk7XHJcbiAgIH07XHJcbiAgIHIucmVhZEFzVGV4dChmaWxlKTtcclxuICAgcmV0dXJuIHI7XHJcbn1cclxuXHJcbmFwcC5kaXJlY3RpdmUoJ2ZpbGVSZWFkZXInLCBmdW5jdGlvbiAoKSB7XHJcbiAgIGZ1bmN0aW9uIHJlYWRGaWxlcyhmaWxlcywgJHNjb3BlKSB7XHJcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmlsZXMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgdmFyIGZpbGUgPSBmaWxlc1tpXTtcclxuICAgICAgICAgdmFyIGNhbGxiYWNrID0gJHNjb3BlLmhhbmRsZUxvYWQ7XHJcbiAgICAgICAgIGV4ZWN1dGVDb250ZW50cygkc2NvcGUsIGNhbGxiYWNrLCBmaWxlKTtcclxuICAgICAgfVxyXG4gICB9XHJcblxyXG4gICBmdW5jdGlvbiByZWFkQXJiaXRyYXRvckZpbGUoZmlsZXMsICRzY29wZSkge1xyXG4gICAgICB2YXIgY2FsbGJhY2sgPSAkc2NvcGUuaGFuZGxlQXJiaXRyYXRvckxvYWQ7XHJcbiAgICAgIGV4ZWN1dGVDb250ZW50cygkc2NvcGUsIGNhbGxiYWNrLCBmaWxlc1swXSk7XHJcbiAgIH1cclxuXHJcbiAgIHJldHVybiB7XHJcbiAgICAgIHNjb3BlOiB0cnVlLFxyXG4gICAgICBsaW5rOiBmdW5jdGlvbiAoJHNjb3BlLCBlbGVtZW50KSB7XHJcbiAgICAgICAgIGVsZW1lbnQub24oJ2NoYW5nZScsIGZ1bmN0aW9uIChjaGFuZ2VFdmVudCkge1xyXG4gICAgICAgICAgICB2YXIgZmlsZXMgPSBjaGFuZ2VFdmVudC50YXJnZXQuZmlsZXM7XHJcbiAgICAgICAgICAgIGlmIChlbGVtZW50WzBdLmlkID09PSAnYXJiaXRyYXRvckZpbGUnKSB7XHJcbiAgICAgICAgICAgICAgIHJlYWRBcmJpdHJhdG9yRmlsZShmaWxlcywgJHNjb3BlKSAgICAgO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICByZWFkRmlsZXMoZmlsZXMsICRzY29wZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxlbWVudFswXS52YWx1ZSA9IG51bGw7XHJcbiAgICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgIH07XHJcbn0pOyIsImFwcC5mYWN0b3J5KCdrZXlSZW1hcHBlcicsIGZ1bmN0aW9uKCkge1xyXG5cclxuICAgZnVuY3Rpb24gcmVtYXBLZXlzKGtleU1hcCwgb2JqZWN0KSB7XHJcbiAgICAgIHJldHVybiBfLnJlZHVjZShvYmplY3QsIGZ1bmN0aW9uIChyZXN1bHQsIHZhbHVlLCBjdXJyZW50S2V5KSB7XHJcbiAgICAgICAgIHZhciB1cGRhdGVkS2V5ID0ga2V5TWFwW2N1cnJlbnRLZXldIHx8IGN1cnJlbnRLZXk7XHJcbiAgICAgICAgIHJlc3VsdFt1cGRhdGVkS2V5XSA9IHZhbHVlO1xyXG4gICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICB9LCB7fSk7XHJcbiAgIH1cclxuXHJcbiAgIHJldHVybiB7XHJcbiAgICAgIHJlbWFwS2V5czogcmVtYXBLZXlzXHJcbiAgIH1cclxufSk7IiwiYXBwLmZhY3RvcnkoJ1Byb2plY3QnLCBmdW5jdGlvbigpIHtcclxuICAgdmFyIHByb2plY3QgPSB7XHJcbiAgICAgIG5hbWU6ICdBcmJpdHJhdGlvbicsXHJcbiAgICAgIGNhc2VJZEtleTogJ1EzOCBDYXNlIElEIChmcm9tIHNwcmVhZHNoZWV0KScsIC8vIFRPRE86IERvbid0IGhhcmQtY29kZSB0aGVzZS5cclxuICAgICAgY29kZXJJZEtleTogJ1EzOSBDb2RlcjonLFxyXG4gICAgICBjYXNlSW5mbzoge30sXHJcbiAgICAgIGludmFyaWF0ZUhlYWRlcnM6IFsnUTU3IENvdW50cnkgTmFtZSAoZnJvbSBzcHJlYWRzaGVldCknLCAnUTU2IFllYXIgKGZyb20gc3ByZWFkc2hlZXQpJ11cclxuICAgfTtcclxuXHJcbiAgIHZhciBkaXJ0eSA9IGZhbHNlO1xyXG5cclxuICAgcmV0dXJuIHtcclxuICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgcmV0dXJuIHByb2plY3Q7XHJcbiAgICAgIH0sXHJcbiAgICAgIGlzRGlydHk6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICByZXR1cm4gZGlydHk7XHJcbiAgICAgIH0sXHJcbiAgICAgIG1hcmtEaXJ0eTogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgIGRpcnR5ID0gdHJ1ZTtcclxuICAgICAgfSxcclxuICAgICAgY2xlYXJEaXJ0eUZsYWc6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICBkaXJ0eSA9IGZhbHNlO1xyXG4gICAgICB9LFxyXG4gICAgICBnZXREYXRhRm9yU2F2aW5nOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgcmV0dXJuIHByb2plY3Q7XHJcbiAgICAgIH0sXHJcbiAgICAgIHNldERhdGFGcm9tTG9hZGluZzogZnVuY3Rpb24obG9hZGVkRGF0YSkge1xyXG4gICAgICAgICBhbmd1bGFyLm1lcmdlKHByb2plY3QsIGxvYWRlZERhdGEpO1xyXG4gICAgICB9LFxyXG4gICB9XHJcbn0pOyIsImFwcC5mYWN0b3J5KCdxdWVzdGlvbk5vcm1hbGl6YXRpb24nLCBbJ3F1ZXN0aW9uU29ydGVyJywgZnVuY3Rpb24ocXVlc3Rpb25Tb3J0ZXIpIHtcclxuICAgdmFyIGtleU1hcCA9IHt9O1xyXG5cclxuICAgdmFyIHJlbWFwcGluZ0NhbGxiYWNrcyA9IGpRdWVyeS5DYWxsYmFja3MoKTtcclxuXHJcbiAgIGZ1bmN0aW9uIGFkZE1hcHBpbmdzKG1hcHBpbmdzKSB7XHJcbiAgICAgIGFuZ3VsYXIubWVyZ2Uoa2V5TWFwLCBtYXBwaW5ncyk7XHJcbiAgICAgIF8uZm9yRWFjaChtYXBwaW5ncywgZnVuY3Rpb24obmV3TmFtZSwgb2xkTmFtZSkge1xyXG4gICAgICAgICByZW1hcHBpbmdDYWxsYmFja3MuZmlyZShvbGROYW1lLCBuZXdOYW1lKTtcclxuICAgICAgfSk7XHJcbiAgIH1cclxuXHJcbiAgIGZ1bmN0aW9uIHJlbW92ZU1hcHBpbmcob2xkTmFtZSkge1xyXG4gICAgICB2YXIgbmV3TmFtZSA9IGtleU1hcFtvbGROYW1lXTtcclxuICAgICAgcmVtYXBwaW5nQ2FsbGJhY2tzLmZpcmUobmV3TmFtZSwgb2xkTmFtZSk7XHJcbiAgICAgIGRlbGV0ZSBrZXlNYXBbb2xkTmFtZV07XHJcbiAgIH1cclxuXHJcbiAgIGZ1bmN0aW9uIGdldEN1cnJlbnRNYXAoKSB7XHJcbiAgICAgIHJldHVybiBrZXlNYXA7XHJcbiAgIH1cclxuXHJcbiAgIGZ1bmN0aW9uIGdldFNvcnRlZE1hcCgpIHtcclxuICAgICAgdmFyIHNvcnRlZEtleXMgPSBxdWVzdGlvblNvcnRlci5nZXRTb3J0ZWRLZXlzKGtleU1hcCwgMCk7XHJcbiAgICAgIHJldHVybiBzb3J0ZWRLZXlzLm1hcChmdW5jdGlvbihrZXkpIHtcclxuICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgb2xkTmFtZToga2V5LFxyXG4gICAgICAgICAgICBuZXdOYW1lOiBrZXlNYXBba2V5XVxyXG4gICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICB9XHJcblxyXG4gICByZXR1cm4ge1xyXG4gICAgICBhZGRNYXBwaW5nczogYWRkTWFwcGluZ3MsXHJcbiAgICAgIHJlbW92ZU1hcHBpbmc6IHJlbW92ZU1hcHBpbmcsXHJcbiAgICAgIHNldERhdGFGcm9tTG9hZGluZzogYWRkTWFwcGluZ3MsXHJcbiAgICAgIGdldEN1cnJlbnRNYXA6IGdldEN1cnJlbnRNYXAsXHJcbiAgICAgIGdldFNvcnRlZE1hcDogZ2V0U29ydGVkTWFwLFxyXG4gICAgICBnZXREYXRhRm9yU2F2aW5nOiBnZXRDdXJyZW50TWFwLFxyXG5cclxuICAgICAgYWRkUmVtYXBwaW5nQ2FsbGJhY2s6IGZ1bmN0aW9uIChjYWxsYmFjaykge1xyXG4gICAgICAgICByZW1hcHBpbmdDYWxsYmFja3MuYWRkKGNhbGxiYWNrKTtcclxuICAgICAgfVxyXG4gICB9XHJcbn1dKTsiLCJhcHAuZmFjdG9yeSgncXVlc3Rpb25Tb3J0ZXInLCBmdW5jdGlvbigpIHtcclxuXHJcbiAgIGZ1bmN0aW9uIHF1YWx0cmljc1NvcnQoYSwgYikge1xyXG4gICAgICBmdW5jdGlvbiBxdWFsdHJpY3NOdW0ocXVlc3Rpb25JZCkgeyAgLy8gTm90IHByb3VkIG9mIHRoaXMgZnVuY3Rpb25cclxuICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgcXVlc3Rpb25JZCA9IHF1ZXN0aW9uSWQuc3BsaXQoXCIgXCIpWzBdO1xyXG4gICAgICAgICAgICB2YXIgdW5kSW5kZXggPSBxdWVzdGlvbklkLmluZGV4T2YoXCJfXCIpO1xyXG4gICAgICAgICAgICBpZiAodW5kSW5kZXggPT0gLTEpIHtcclxuICAgICAgICAgICAgICAgdW5kSW5kZXggPSBxdWVzdGlvbklkLmxlbmd0aDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB2YXIgcXVlc3Rpb25OdW0gPSBwYXJzZUludChxdWVzdGlvbklkLnN1YnN0cmluZygxLCB1bmRJbmRleCsxKSk7XHJcbiAgICAgICAgICAgIHF1ZXN0aW9uSWQgPSBxdWVzdGlvbklkLnN1YnN0cmluZyh1bmRJbmRleCsxKTtcclxuICAgICAgICAgICAgdmFyIG5leHRVbmRJbmRleCA9IHF1ZXN0aW9uSWQuaW5kZXhPZihcIl9cIik7XHJcbiAgICAgICAgICAgIGlmIChuZXh0VW5kSW5kZXggPT0gLTEpIHtcclxuICAgICAgICAgICAgICAgcmV0dXJuIHF1ZXN0aW9uTnVtO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZhciBzdWJOdW0gPSBwYXJzZUludChxdWVzdGlvbklkLnN1YnN0cmluZygwLCB1bmRJbmRleCsxKSk7XHJcbiAgICAgICAgICAgIHJldHVybiBxdWVzdGlvbk51bSArIHN1Yk51bS8xMDA7XHJcbiAgICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgcmV0dXJuIC0xO1xyXG4gICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuIHF1YWx0cmljc051bShhKSAtIHF1YWx0cmljc051bShiKTtcclxuICAgfVxyXG5cclxuICAgZnVuY3Rpb24gZ2V0U29ydGVkS2V5cyhvYmplY3RXaXRoS2V5cywgZGVwdGgpIHtcclxuICAgICAgdmFyIHVuaXF1ZUtleXMgPSB7fTtcclxuICAgICAgZm9yICh2YXIgYmFzZUtleSBpbiBvYmplY3RXaXRoS2V5cykge1xyXG4gICAgICAgICBpZiAoZGVwdGggPiAwKSB7XHJcbiAgICAgICAgICAgIHZhciBuZXN0ZWRPYmplY3QgPSBvYmplY3RXaXRoS2V5c1tiYXNlS2V5XTtcclxuICAgICAgICAgICAgZm9yICh2YXIgbmVzdGVkS2V5IGluIG5lc3RlZE9iamVjdCkge1xyXG4gICAgICAgICAgICAgICBpZiAoZGVwdGggPiAxKSB7XHJcbiAgICAgICAgICAgICAgICAgIHZhciBuZXN0ZWROZXN0ZWRPYmplY3QgPSBuZXN0ZWRPYmplY3RbbmVzdGVkS2V5XTtcclxuICAgICAgICAgICAgICAgICAgZm9yICh2YXIgZG91YmxlTmVzdGVkS2V5IGluIG5lc3RlZE5lc3RlZE9iamVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgICB1bmlxdWVLZXlzW2RvdWJsZU5lc3RlZEtleV0gPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgdW5pcXVlS2V5c1tuZXN0ZWRLZXldID0gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdW5pcXVlS2V5c1tiYXNlS2V5XSA9IHVuZGVmaW5lZDtcclxuICAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBPYmplY3Qua2V5cyh1bmlxdWVLZXlzKS5zb3J0KHF1YWx0cmljc1NvcnQpXHJcbiAgIH1cclxuXHJcbiAgIHJldHVybiB7XHJcbiAgICAgIGdldFNvcnRlZEtleXM6IGdldFNvcnRlZEtleXMsXHJcbiAgIH1cclxufSkiLCJhcHAuY29udHJvbGxlcignc2V0dXBDb250cm9sbGVyJywgWyckc2NvcGUnLCAnY29kZXJEYXRhJywgJ2FyYml0cmF0b3JEYXRhJywgJ3NpZGViYXJEaXNwbGF5Q2FzZXMnLCAnUHJvamVjdCcsICdxdWVzdGlvbk5vcm1hbGl6YXRpb24nLFxyXG4gICAgICBmdW5jdGlvbigkc2NvcGUsIGNvZGVyRGF0YSwgYXJiaXRyYXRvckRhdGEsIHNpZGViYXJEaXNwbGF5Q2FzZXMsIFByb2plY3QsIHF1ZXN0aW9uTm9ybWFsaXphdGlvbikge1xyXG5cclxuICAgJHNjb3BlLnByb2plY3QgPSBQcm9qZWN0LmdldCgpO1xyXG5cclxuICAgJHNjb3BlLmhhbmRsZUxvYWQgPSBmdW5jdGlvbihmaWxlQ29udGVudHMpIHtcclxuICAgICAgY29kZXJEYXRhLmltcG9ydFJhd0RhdGEoZmlsZUNvbnRlbnRzLCAkc2NvcGUucHJvamVjdC5jYXNlSWRLZXksICRzY29wZS5wcm9qZWN0LmNvZGVySWRLZXkpO1xyXG4gICB9O1xyXG5cclxuICAgJHNjb3BlLmhhbmRsZUFyYml0cmF0b3JMb2FkID0gZnVuY3Rpb24oZmlsZUNvbnRlbnRzKSB7XHJcbiAgICAgIGFyYml0cmF0b3JEYXRhLmltcG9ydFJhd0RhdGEoZmlsZUNvbnRlbnRzLCAkc2NvcGUucHJvamVjdC5jYXNlSWRLZXkpO1xyXG4gICB9O1xyXG5cclxuXHJcbiAgIGZ1bmN0aW9uIGNsZWFyQWRkaW5nKCkge1xyXG4gICAgICAkc2NvcGUuYWRkaW5nID0gZmFsc2U7XHJcbiAgICAgICRzY29wZS5hZGRlZE9sZCA9IFwiXCI7XHJcbiAgICAgICRzY29wZS5hZGRlZE5ldyA9IFwiXCI7XHJcbiAgICAgIGVkaXRlZFJvd0tleSA9IG51bGw7XHJcbiAgIH1cclxuICAgY2xlYXJBZGRpbmcoKTtcclxuXHJcbiAgICRzY29wZS5zdGFydEFkZGluZyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAkc2NvcGUuYWRkaW5nID0gdHJ1ZTtcclxuICAgfTtcclxuXHJcbiAgICRzY29wZS5maW5pc2hBZGRpbmcgPSBmdW5jdGlvbigpIHtcclxuICAgICAgJHNjb3BlLmFkZGluZyA9IGZhbHNlO1xyXG4gICAgICB2YXIgb2xkTmFtZSA9ICRzY29wZS5hZGRlZE9sZDtcclxuICAgICAgaWYgKHF1ZXN0aW9uTm9ybWFsaXphdGlvbi5nZXRDdXJyZW50TWFwKClbb2xkTmFtZV0pIHtcclxuICAgICAgICAgcXVlc3Rpb25Ob3JtYWxpemF0aW9uLnJlbW92ZU1hcHBpbmcob2xkTmFtZSk7XHJcbiAgICAgIH1cclxuICAgICAgdmFyIG1hcHBpbmcgPSB7fTtcclxuICAgICAgbWFwcGluZ1tvbGROYW1lXSA9ICRzY29wZS5hZGRlZE5ldztcclxuICAgICAgcXVlc3Rpb25Ob3JtYWxpemF0aW9uLmFkZE1hcHBpbmdzKG1hcHBpbmcpO1xyXG4gICAgICBjbGVhckFkZGluZygpO1xyXG4gICAgICByZWZyZXNoKCk7XHJcbiAgIH07XHJcblxyXG4gICAkc2NvcGUuY2FuY2VsQWRkaW5nID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICRzY29wZS5hZGRpbmcgPSBmYWxzZTtcclxuICAgICAgY2xlYXJBZGRpbmcoKTtcclxuICAgfTtcclxuXHJcbiAgICRzY29wZS5lZGl0ID0gZnVuY3Rpb24ob2xkVGV4dCwgbmV3VGV4dCkge1xyXG4gICAgICAkc2NvcGUuYWRkZWRPbGQgPSBvbGRUZXh0O1xyXG4gICAgICAkc2NvcGUuYWRkZWROZXcgPSBuZXdUZXh0O1xyXG4gICAgICAkc2NvcGUuYWRkaW5nID0gdHJ1ZTtcclxuICAgICAgZWRpdGVkUm93S2V5ID0gb2xkVGV4dDtcclxuICAgfTtcclxuXHJcbiAgICRzY29wZS5yZW1vdmVNYXBwaW5nID0gZnVuY3Rpb24ob2xkVGV4dCkge1xyXG4gICAgICBxdWVzdGlvbk5vcm1hbGl6YXRpb24ucmVtb3ZlTWFwcGluZyhvbGRUZXh0KTtcclxuICAgICAgcmVmcmVzaCgpO1xyXG4gICB9O1xyXG5cclxuICAgdmFyIGVkaXRlZFJvd0tleSA9IG51bGw7XHJcbiAgICRzY29wZS5pc0VkaXRpbmcgPSBmdW5jdGlvbihvbGRUZXh0KSB7XHJcbiAgICAgIHJldHVybiBvbGRUZXh0ID09PSBlZGl0ZWRSb3dLZXk7XHJcbiAgIH07XHJcblxyXG4gICBmdW5jdGlvbiByZWZyZXNoKCkge1xyXG4gICAgICAkc2NvcGUubm9ybWFsaXplZEtleU1hcCA9IHF1ZXN0aW9uTm9ybWFsaXphdGlvbi5nZXRTb3J0ZWRNYXAoKTtcclxuICAgfVxyXG4gICBhcmJpdHJhdG9yRGF0YS5hZGRMb2FkQ29tcGxldGVDYWxsYmFjayhyZWZyZXNoKTtcclxufV0pOyIsImFwcC5jb250cm9sbGVyKCdzaWRlYmFyQ29udHJvbGxlcicsIFsnJHNjb3BlJywgJ3NpZGViYXJEaXNwbGF5Q2FzZXMnLCAnY3VycmVudFBhZ2UnLCAnQ2FzZScsIGZ1bmN0aW9uKCRzY29wZSwgc2lkZWJhckRpc3BsYXlDYXNlcywgY3VycmVudFBhZ2UsIENhc2UpIHtcclxuICAgJHNjb3BlLmdldENhc2VzID0gc2lkZWJhckRpc3BsYXlDYXNlcy5nZXQ7XHJcbiAgIHZhciBpbmNsdWRlU2luZ2xlQ29kZWQgPSB7XHJcbiAgICAgIGRpc3BsYXk6ICdTaW5nbGUgQ29kZWQnLFxyXG4gICAgICB2YWx1ZTogZmFsc2VcclxuICAgfTtcclxuICAgdmFyIGluY2x1ZGVEb3VibGVDb2RlZCA9IHtcclxuICAgICAgZGlzcGxheTogJ0RvdWJsZSBDb2RlZCcsXHJcbiAgICAgIHZhbHVlOiB0cnVlXHJcbiAgIH07XHJcbiAgIHZhciBpbmNsdWRlRnVsbHlBcmJpdHJhdGVkID0ge1xyXG4gICAgICBkaXNwbGF5OiAnRnVsbHkgQXJiaXRyYXRlZCcsXHJcbiAgICAgIHZhbHVlOiBmYWxzZVxyXG4gICB9O1xyXG5cclxuICAgJHNjb3BlLmZpbHRlcnMgPSBbXHJcbiAgICAgIGluY2x1ZGVTaW5nbGVDb2RlZCxcclxuICAgICAgaW5jbHVkZURvdWJsZUNvZGVkLFxyXG4gICAgICBpbmNsdWRlRnVsbHlBcmJpdHJhdGVkXHJcbiAgIF07XHJcbiAgICRzY29wZS5maWx0ZXJUZXh0ID0gXCJcIjtcclxuXHJcbiAgIGZ1bmN0aW9uIHBhc3Nlc0FyYml0cmF0aW9uQ2hlY2tib3hlcyhjYXNlT2JqZWN0KSB7XHJcbiAgICAgIGlmIChjYXNlT2JqZWN0LmNvdW50ID09IDEpIHtcclxuICAgICAgICAgcmV0dXJuIGluY2x1ZGVTaW5nbGVDb2RlZC52YWx1ZTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gY2FzZU9iamVjdC5mdWxseUFyYml0cmF0ZWQgP1xyXG4gICAgICAgICBpbmNsdWRlRnVsbHlBcmJpdHJhdGVkLnZhbHVlIDpcclxuICAgICAgICAgaW5jbHVkZURvdWJsZUNvZGVkLnZhbHVlO1xyXG4gICB9XHJcblxyXG4gICBmdW5jdGlvbiBwYXNzZXNGaWx0ZXJUZXh0KGNhc2VPYmplY3QpIHtcclxuICAgICAgcmV0dXJuICRzY29wZS5maWx0ZXJUZXh0ID09IFwiXCIgfHxcclxuICAgICAgICAgICAgIGNhc2VPYmplY3QuZGlzcGxheVRleHQuaW5kZXhPZigkc2NvcGUuZmlsdGVyVGV4dCkgPiAtMTtcclxuICAgfVxyXG5cclxuICAgZnVuY3Rpb24gcGFzc2VzQ29kZXJDaGVja2JveGVzKGNhc2VPYmplY3QpIHtcclxuXHJcbiAgIH1cclxuXHJcbiAgICRzY29wZS5zaG91bGREaXNwbGF5ID0gZnVuY3Rpb24oY2FzZU9iamVjdCkge1xyXG4gICAgICByZXR1cm4gcGFzc2VzQXJiaXRyYXRpb25DaGVja2JveGVzKGNhc2VPYmplY3QpICYmIHBhc3Nlc0ZpbHRlclRleHQoY2FzZU9iamVjdCk7XHJcbiAgIH07XHJcblxyXG4gICAkc2NvcGUuc3dpdGNoVG9DYXNlID0gZnVuY3Rpb24oY2FzZUtleSkge1xyXG4gICAgICBjdXJyZW50UGFnZS5zd2l0Y2hUb0Nhc2UoKTtcclxuICAgICAgQ2FzZS5zZXRDdXJyZW50KGNhc2VLZXkpO1xyXG4gICB9O1xyXG5cclxuICAgJHNjb3BlLmlzU2VsZWN0ZWQgPSBmdW5jdGlvbihjYXNlSWQpIHtcclxuICAgICAgcmV0dXJuIENhc2UuZ2V0Q3VycmVudCgpID09PSBjYXNlSWQ7XHJcbiAgIH1cclxufV0pO1xyXG5cclxuIiwiYXBwLmZhY3RvcnkoJ3NpZGViYXJSZWZyZXNoU2VydmljZScsIGZ1bmN0aW9uKCkge1xyXG4gICBjb25zdCBjYWxsYmFja3MgPSBqUXVlcnkuQ2FsbGJhY2tzKCk7XHJcbiAgIHJldHVybiB7XHJcbiAgICAgIHN1YnNjcmliZVRvUmVmcmVzaDogZnVuY3Rpb24oY2FsbGJhY2spIHtcclxuICAgICAgICAgY2FsbGJhY2tzLmFkZChjYWxsYmFjayk7XHJcbiAgICAgIH0sXHJcbiAgICAgIHRyaWdnZXJSZWZyZXNoOiBmdW5jdGlvbihjYXNlSWQpIHtcclxuICAgICAgICAgY2FsbGJhY2tzLmZpcmUoY2FzZUlkKTtcclxuICAgICAgfVxyXG4gICB9XHJcbn0pOyIsImFwcC5mYWN0b3J5KCdzaWRlYmFyRGlzcGxheUNhc2VzJywgWydjb2RlckRhdGEnLCAnYXJiaXRyYXRvckRhdGEnLCAnY2FzZUluZm9TZXJ2aWNlJywgJ3NpZGViYXJSZWZyZXNoU2VydmljZScsXHJcbmZ1bmN0aW9uKGNvZGVyRGF0YSwgYXJiaXRyYXRvckRhdGEsIGNhc2VJbmZvU2VydmljZSwgc2lkZWJhclJlZnJlc2hTZXJ2aWNlKSB7XHJcbiAgIHZhciBkaXNwbGF5Q2FzZXMgPSBbXTtcclxuXHJcbiAgIGZ1bmN0aW9uIHJlZnJlc2goKSB7XHJcbiAgICAgIHZhciBjYXNlcyA9IGNvZGVyRGF0YS5nZXRDYXNlcygpO1xyXG4gICAgICBkaXNwbGF5Q2FzZXMgPSBPYmplY3Qua2V5cyhjYXNlcykubWFwKGZ1bmN0aW9uIChjYXNlSWQpIHtcclxuICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgaWQ6IGNhc2VJZCxcclxuICAgICAgICAgICAgY291bnQ6IE9iamVjdC5rZXlzKGNhc2VzW2Nhc2VJZF0pLmxlbmd0aCxcclxuICAgICAgICAgICAgZnVsbHlBcmJpdHJhdGVkOiBhcmJpdHJhdG9yRGF0YS5pc0Z1bGx5QXJiaXRyYXRlZChjYXNlSWQpLFxyXG4gICAgICAgICAgICBwYXJ0aWFsbHlBcmJpdHJhdGVkOiBhcmJpdHJhdG9yRGF0YS5pc1BhcnRpYWxseUFyYml0cmF0ZWQoY2FzZUlkKSxcclxuICAgICAgICAgICAgZGlzcGxheVRleHQ6IGNhc2VJbmZvU2VydmljZS5nZXRGdWxsVGl0bGUoY2FzZUlkKSxcclxuICAgICAgICAgICAgZmxhZzogY2FzZUluZm9TZXJ2aWNlLmdldEZsYWcoY2FzZUlkKSxcclxuICAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgfVxyXG5cclxuICAgZnVuY3Rpb24gcmVmcmVzaENhc2UoY2FzZUlkKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGNhc2VJZCk7XHJcbiAgICAgIHJlZnJlc2goKTsgLy9UT0RPIFRoaXMgaXMgbW9yZSB0aGFuIG5lY2Vzc2FyeS5cclxuICAgfVxyXG5cclxuICAgYXJiaXRyYXRvckRhdGEuYWRkTG9hZENvbXBsZXRlQ2FsbGJhY2socmVmcmVzaCk7XHJcbiAgIGNvZGVyRGF0YS5hZGRMb2FkQ29tcGxldGVDYWxsYmFjayhyZWZyZXNoKTtcclxuICAgc2lkZWJhclJlZnJlc2hTZXJ2aWNlLnN1YnNjcmliZVRvUmVmcmVzaChyZWZyZXNoQ2FzZSk7XHJcblxyXG4gICByZXR1cm4ge1xyXG4gICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICByZXR1cm4gZGlzcGxheUNhc2VzO1xyXG4gICAgICB9XHJcbiAgIH1cclxuXHJcbn1dKTsiLCJhcHAuY29udHJvbGxlcigndG9vbGJhckNvbnRyb2xsZXInLCBbJyRzY29wZScsICdQcm9qZWN0JywgJ2N1cnJlbnRQYWdlJywgJ2Rpc2snLFxyXG4gICBmdW5jdGlvbigkc2NvcGUsIFByb2plY3QsIGN1cnJlbnRQYWdlLCBkaXNrKSB7XHJcbiAgICAgICRzY29wZS5zYXZlID0gZGlzay5zYXZlO1xyXG4gICAgICAkc2NvcGUub3BlbiA9IGRpc2subG9hZDtcclxuICAgICAgJHNjb3BlLmV4cG9ydFJlbGlhYmlsaXR5ID0gZGlzay5leHBvcnRSZWxpYWJpbGl0eTtcclxuICAgICAgJHNjb3BlLnN3aXRjaFRvU2V0dXAgPSBjdXJyZW50UGFnZS5zd2l0Y2hUb1NldHVwO1xyXG4gICAgICAkc2NvcGUub25seUluY2x1ZGVGdWxseUFyYml0cmF0ZWQgPSB7XHJcbiAgICAgICAgIHZhbHVlOiBmYWxzZVxyXG4gICAgICB9O1xyXG4gICAgICAkc2NvcGUuZXhwb3J0ID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgIGRpc2suZXhwb3J0Q3N2KCRzY29wZS5vbmx5SW5jbHVkZUZ1bGx5QXJiaXRyYXRlZC52YWx1ZSk7XHJcbiAgICAgIH07XHJcblxyXG4gICAgICAkc2NvcGUuaGFuZGxlTG9hZCA9IGRpc2subG9hZDtcclxufV0pO1xyXG4iXX0=
